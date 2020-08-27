/**
 * Copyright 2015 CANAL+ Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  Observable,
  Observer,
  of as observableOf,
} from "rxjs";
import xhr, {
  fetchIsSupported,
} from "../../utils/request";
import warnOnce from "../../utils/warn_once";
import {
  CustomSegmentLoader,
  ISegmentLoaderArguments,
  ISegmentLoaderEvent,
  ITransportAudioVideoSegmentLoader,
} from "../types";
import byteRange from "../utils/byte_range";
import isWEBMEmbeddedTrack from "../utils/is_webm_embedded_track";
import performSegmentRequest from "../utils/segment_request";
import addSegmentIntegrityChecks from "./add_segment_integrity_checks_to_loader";
import initSegmentLoader from "./init_segment_loader";
import lowLatencySegmentLoader from "./low_latency_segment_loader";

type ICustomSegmentLoaderObserver =
  Observer<ISegmentLoaderEvent<Uint8Array|ArrayBuffer>>;

/**
 * Segment loader triggered if there was no custom-defined one in the API.
 * @param {Object} opt
 * @returns {Observable}
 */
function regularSegmentLoader(
  url : string,
  args : ISegmentLoaderArguments,
  lowLatencyMode : boolean
) : Observable< ISegmentLoaderEvent<ArrayBuffer>> {

  if (args.segment.isInit) {
    return initSegmentLoader(url, args);
  }

  const isWEBM = isWEBMEmbeddedTrack(args.representation);
  if (lowLatencyMode && !isWEBM) {
    if (fetchIsSupported()) {
      return lowLatencySegmentLoader(url, args);
    } else {
      warnOnce("DASH: Your browser does not have the fetch API. You will have " +
               "a higher chance of rebuffering when playing close to the live edge");
    }
  }

  const { segment } = args;
  return performSegmentRequest(xhr({ url,
                                     responseType: "arraybuffer",
                                     sendProgressEvents: true,
                                     headers: segment.range !== undefined ?
                                       { Range: byteRange(segment.range) } :
                                       undefined }));
}

/**
 * Generate a segment loader:
 *   - call a custom SegmentLoader if defined
 *   - call the regular loader if not
 * @param {Object} args
 * @returns {Function}
 */
export default function generateSegmentLoader(
  { lowLatencyMode,
    segmentLoader: customSegmentLoader,
    checkMediaSegmentIntegrity } : { lowLatencyMode: boolean;
                                     segmentLoader? : CustomSegmentLoader;
                                     checkMediaSegmentIntegrity? : boolean; }
) : ITransportAudioVideoSegmentLoader {
  return checkMediaSegmentIntegrity !== true ? segmentLoader :
                                               addSegmentIntegrityChecks(segmentLoader);

  /**
   * @param {Object} content
   * @returns {Observable}
   */
  function segmentLoader(
    content : ISegmentLoaderArguments
  ) : Observable< ISegmentLoaderEvent< Uint8Array | ArrayBuffer | null > > {
    const { url } = content;
    if (url == null) {
      return observableOf({ type: "data" as const, value: { responseData: null } });
    }

    if (lowLatencyMode || customSegmentLoader === undefined) {
      return regularSegmentLoader(url, content, lowLatencyMode);
    }

    const args = { adaptation: content.adaptation,
                   manifest: content.manifest,
                   period: content.period,
                   representation: content.representation,
                   segment: content.segment,
                   transport: "dash",
                   url };

    return new Observable((obs : ICustomSegmentLoaderObserver) => {
      let hasFinished = false;
      let hasFallbacked = false;

      /**
       * Callback triggered when the custom segment loader has a response.
       * @param {Object} args
       */
      const resolve = (
        _args : { data : ArrayBuffer|Uint8Array;
                  size? : number;
                  duration? : number; }
      ) => {
        if (!hasFallbacked) {
          hasFinished = true;
          obs.next({ type: "data" as const,
                     value: { responseData: _args.data } });
          obs.next({ type: "request-end",
                     value: { size: _args.size,
                              duration: _args.duration,
                              receivedTime: undefined,
                              sendingTime: undefined } });
          obs.complete();
        }
      };

      /**
       * Callback triggered when the custom segment loader fails
       * @param {*} err - The corresponding error encountered
       */
      const reject = (err = {}) : void => {
        if (!hasFallbacked) {
          hasFinished = true;
          obs.error(err);
        }
      };

      const progress = (
        _args : { duration : number;
                  size : number;
                  totalSize? : number; }
      ) => {
        if (!hasFallbacked) {
          obs.next({ type: "progress", value: { duration: _args.duration,
                                                size: _args.size,
                                                totalSize: _args.totalSize } });
        }
      };

      /**
       * Callback triggered when the custom segment loader wants to fallback to
       * the "regular" implementation
       */
      const fallback = () => {
        hasFallbacked = true;
        const regular$ = regularSegmentLoader(url, content, lowLatencyMode);
        regular$.subscribe(obs);
      };

      const callbacks = { reject, resolve, progress, fallback };

      // We cannot know for sure if `customManifestLoader` will perform a
      // request or even multiple ones.
      // Assume it makes a single one starting now as a sensible default.
      obs.next({ type: "request-begin", value: { } });
      const abort = customSegmentLoader(args, callbacks);

      return () => {
        if (!hasFinished && !hasFallbacked && typeof abort === "function") {
          abort();
        }
      };
    });
  }
}
