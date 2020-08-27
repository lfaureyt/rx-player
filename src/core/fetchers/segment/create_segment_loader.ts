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
  of as observableOf,
} from "rxjs";
import {
  catchError,
  map,
  mergeMap,
} from "rxjs/operators";
import { ICustomError } from "../../../errors";
import Manifest, {
  Adaptation,
  ISegment,
  Period,
  Representation,
} from "../../../manifest";
import {
  ILoaderRequestBeginEvent,
  ILoaderRequestEndEvent,
  ILoaderRequestProgressEvent,
  ISegmentLoaderArguments,
  ISegmentLoaderEvent as ITransportSegmentLoaderEvent,
} from "../../../transports";
import assertUnreachable from "../../../utils/assert_unreachable";
import castToObservable from "../../../utils/cast_to_observable";
import objectAssign from "../../../utils/object_assign";
import tryCatch from "../../../utils/rx-try_catch";
import errorSelector from "../utils/error_selector";
import tryURLsWithBackoff, {
  IBackoffOptions,
} from "../utils/try_urls_with_backoff";

/** Data comes from a local JS cache maintained here, no request was done. */
interface ISegmentLoaderCachedSegmentEvent<T> { type : "cache";
                                                value : { responseData: T | null }; }

/** An Error happened while loading (usually a request error). */
export interface ISegmentLoaderWarning { type : "warning";
                                         value : ICustomError; }

/** The whole segment's data (not only a chunk) is available. */
export interface ISegmentLoaderData<T> { type : "data";
                                         value : { responseData : T | null }; }

/**
 * A chunk of the data is available.
 * You will receive every chunk through such events until a
 * ISegmentLoaderChunkComplete event is received.
 */
export interface ISegmentLoaderChunk { type : "chunk";
                                       value : { responseData : null |
                                                                ArrayBuffer |
                                                                Uint8Array; }; }

/** The data has been entirely sent through "chunk" events. */
export interface ISegmentLoaderChunkComplete { type : "chunk-complete";
                                               value : null; }

/**
 * Every events the segment loader emits.
 * Type parameters: T: Argument given to the loader
 *                  U: ResponseType of the request
 */
export type ISegmentLoaderEvent<T> = ISegmentLoaderData<T> |
                                     ILoaderRequestBeginEvent |
                                     ILoaderRequestProgressEvent |
                                     ILoaderRequestEndEvent |
                                     ISegmentLoaderWarning |
                                     ISegmentLoaderChunk |
                                     ISegmentLoaderChunkComplete;

/** Cache implementation to avoid re-requesting segment */
export interface ISegmentLoaderCache<T> {
  /** Add a segment to the cache. */
  add : (obj : ISegmentLoaderContent, arg : { responseData: T }) => void;
  /** Retrieve a segment from the cache */
  get : (obj : ISegmentLoaderContent) => { responseData: T | null };
}

/** Abstraction to load a segment in the current transport protocol. */
export type ISegmentPipelineLoader<T> =
  (x : ISegmentLoaderArguments) => Observable< ITransportSegmentLoaderEvent<T> >;

/** Content used by the segment loader as a context to load a new segment. */
export interface ISegmentLoaderContent { manifest : Manifest;
                                         period : Period;
                                         adaptation : Adaptation;
                                         representation : Representation;
                                         segment : ISegment; }

/**
 * Returns a function allowing to load any wanted segment.
 *
 * The function returned takes in argument information about the wanted segment
 * and returns an Observable which will emit various events related to the
 * segment request (see ISegmentLoaderEvent).
 *
 * This observable will throw if, following the options given, the request and
 * possible retry all failed.
 *
 * This observable will complete after emitting all the segment's data.
 *
 * Type parameters:
 *   - T: type of the data emitted
 *
 * @param {Function} loader
 * @param {Object | undefined} cache
 * @param {Object} options
 * @returns {Function}
 */
export default function createSegmentLoader<T>(
  loader : ISegmentPipelineLoader<T>,
  cache : ISegmentLoaderCache<T> | undefined,
  backoffOptions : IBackoffOptions
) : (x : ISegmentLoaderContent) => Observable<ISegmentLoaderEvent<T>> {
  /**
   * Try to retrieve the segment from the cache and if not found call the
   * pipeline's loader (with possible retries) to load it.
   * @param {Object} loaderArgument - Context for the wanted segment.
   * @returns {Observable}
   */
  function loadData(
    wantedContent : ISegmentLoaderContent
  ) : Observable< ITransportSegmentLoaderEvent<T> |
                  ISegmentLoaderWarning |
                  ISegmentLoaderCachedSegmentEvent<T>>
  {

    /**
     * Call the Pipeline's loader with an exponential Backoff.
     * @returns {Observable}
     */
    function startLoaderWithBackoff(
    ) : Observable< ITransportSegmentLoaderEvent<T> |
                    ISegmentLoaderWarning >
    {
      const request$ = (url : string | null) => {
        const loaderArgument = objectAssign({ url }, wantedContent);
        return tryCatch(loader, loaderArgument);
      };
      return tryURLsWithBackoff(wantedContent.segment.mediaURLs ?? [null],
                                request$,
                                backoffOptions).pipe(
        catchError((error : unknown) : Observable<never> => {
          throw errorSelector(error);
        }),

        map((evt) : ITransportSegmentLoaderEvent<T> |
                    ISegmentLoaderWarning => {
          if (evt.type === "retry") {
            return { type: "warning" as const,
                     value: errorSelector(evt.value) };
          }

          const response = evt.value;
          if (response.type === "data" && cache != null) {
            cache.add(wantedContent, response.value);
          }
          return evt.value;
        }));
    }

    const dataFromCache = cache != null ? cache.get(wantedContent) :
                                          null;

    if (dataFromCache != null) {
      return castToObservable(dataFromCache).pipe(
        map(response => ({ type: "cache" as const, value: response })),
        catchError(startLoaderWithBackoff)
      );
    }

    return startLoaderWithBackoff();
  }

  /**
   * Load the corresponding segment.
   * @param {Object} content
   * @returns {Observable}
   */
  return function loadSegment(
    content : ISegmentLoaderContent
  ) : Observable<ISegmentLoaderEvent<T>> {
    return loadData(content).pipe(
      mergeMap((arg) : Observable<ISegmentLoaderEvent<T>> => {
        switch (arg.type) {
          case "request-begin":
          case "progress":
          case "request-end":
          case "warning":
            return observableOf(arg);
          case "cache":
          case "data":
            return observableOf({
              type: "data" as const,
              value: objectAssign({},
                                  content,
                                  { responseData: arg.value.responseData }),
            });

          case "data-chunk":
            return observableOf({ type: "chunk", value: arg.value });
          case "data-chunk-complete":
            return observableOf({ type: "chunk-complete" as const,
                                  value: null });
          default:
            assertUnreachable(arg);
        }
      }));
  };
}
