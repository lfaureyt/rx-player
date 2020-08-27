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
  concat as observableConcat,
  Observable,
  of as observableOf,
  Subject,
} from "rxjs";
import {
  catchError,
  filter,
  finalize,
  mergeMap,
  share,
  tap,
} from "rxjs/operators";
import { formatError } from "../../../errors";
import {
  ISegmentParserResponse,
  ITransportPipelines,
} from "../../../transports";
import arrayIncludes from "../../../utils/array_includes";
import assertUnreachable from "../../../utils/assert_unreachable";
import idGenerator from "../../../utils/id_generator";
import InitializationSegmentCache from "../../../utils/initialization_segment_cache";
import {
  IABRMetricsEvent,
  IABRRequestBeginEvent,
  IABRRequestEndEvent,
  IABRRequestProgressEvent,
} from "../../abr";
import { IBufferType } from "../../source_buffers";
import { IBackoffOptions } from "../utils/try_urls_with_backoff";
import createSegmentLoader, {
  ISegmentLoaderChunk,
  ISegmentLoaderChunkComplete,
  ISegmentLoaderContent,
  ISegmentLoaderData,
  ISegmentLoaderWarning,
} from "./create_segment_loader";

/**
 * Event sent when the segment request needs to be renewed (e.g. due to an HTTP
 * error).
 */
export type ISegmentFetcherWarning = ISegmentLoaderWarning;

/**
 * Event sent when a new "chunk" of the segment is available.
 * A segment can contain n chunk(s) for n >= 0.
 */
export interface ISegmentFetcherChunkEvent<T> {
  type : "chunk";
  /** Parse the downloaded chunk. */
  parse : (initTimescale? : number) => Observable<ISegmentParserResponse<T>>;
}

/**
 * Event sent when all "chunk" of the segments have been communicated through
 * `ISegmentFetcherChunkEvent` events.
 */
export interface ISegmentFetcherChunkCompleteEvent { type: "chunk-complete"; }

/** Event sent by the SegmentFetcher when fetching a segment. */
export type ISegmentFetcherEvent<T> = ISegmentFetcherChunkCompleteEvent |
                                      ISegmentFetcherChunkEvent<T> |
                                      ISegmentFetcherWarning;

export type ISegmentFetcher<T> = (content : ISegmentLoaderContent) =>
                                   Observable<ISegmentFetcherEvent<T>>;

const generateRequestIdPrefix = idGenerator();

/**
 * Create a function which will fetch and parse segments.
 * @param {string} bufferType
 * @param {Object} transport
 * @param {Subject} requests$
 * @param {Object} options
 * @returns {Function}
 */
export default function createSegmentFetcher<T>(
  bufferType : IBufferType,
  transport : ITransportPipelines,
  requests$ : Subject<IABRMetricsEvent |
                      IABRRequestBeginEvent |
                      IABRRequestProgressEvent |
                      IABRRequestEndEvent>,
  options : IBackoffOptions
) : ISegmentFetcher<T> {
  const cache = arrayIncludes(["audio", "video"], bufferType) ?
    new InitializationSegmentCache<any>() :
    undefined;
  const segmentLoader = createSegmentLoader<any>(transport[bufferType].loader,
                                                 cache,
                                                 options);
  const segmentParser = transport[bufferType].parser as any; // deal with it

  /**
   * Process the segmentLoader observable to adapt it to the the rest of the
   * code:
   *   - use the requests subject for network requests and their progress
   *   - use the warning$ subject for retries' error messages
   *   - only emit the data
   * @param {Object} content
   * @returns {Observable}
   */
  return function fetchSegment(
    content : ISegmentLoaderContent
  ) : Observable<ISegmentFetcherEvent<T>> {
    const idPrefix = generateRequestIdPrefix();
    const sentIds : string[] = [];
    return segmentLoader(content).pipe(
      tap((arg) => {
        switch (arg.type) {
          case "request-begin": {
            const { requestId } = arg.value;
            const id = getFetcherId(idPrefix, requestId);
            sentIds.push(id);
            const { segment } = content;
            const duration = segment.duration / segment.timescale;
            const time = segment.time / segment.timescale;
            requests$.next({ type: "requestBegin",
                             value: { duration,
                                      time,
                                      requestTimestamp: performance.now(),
                                      id } });
            break;
          }

          case "progress": {
            const { value } = arg;
            const id = getFetcherId(idPrefix, value.requestId);
            if (value.totalSize != null && value.size < value.totalSize) {
              requests$.next({ type: "progress",
                               value: { duration: value.duration,
                                        size: value.size,
                                        totalSize: value.totalSize,
                                        timestamp: performance.now(),
                                        id } });
            }
            break;
          }

          case "request-end": {
            const { requestId, size, duration } = arg.value;
            const id = getFetcherId(idPrefix, requestId);
            if (size != null && duration != null) {
              requests$.next({ type: "metrics",
                              value: { size, duration, content } });
            }
            const index = sentIds.indexOf(id);
            if (index >= 0) {
              sentIds.splice(index, 1);
              requests$.next({ type: "requestEnd", value: { id } });
            }
            break;
          }
        }
      }),

      finalize(() => {
        while (sentIds.length > 0) {
          requests$.next({ type: "requestEnd", value: { id: sentIds[0] } });
          sentIds.shift();
        }
      }),

      filter((e) : e is ISegmentLoaderChunk |
                        ISegmentLoaderChunkComplete |
                        ISegmentLoaderData<T> |
                        ISegmentFetcherWarning => {
                          switch (e.type) {
                            case "warning":
                            case "chunk":
                            case "chunk-complete":
                            case "data":
                              return true;
                            case "progress":
                            case "request-begin":
                            case "request-end":
                              return false;
                            default:
                              assertUnreachable(e);
                          }
                        }),
      mergeMap((evt) => {
        if (evt.type === "warning") {
          return observableOf(evt);
        }
        if (evt.type === "chunk-complete") {
          return observableOf({ type: "chunk-complete" as const });
        }

        const isChunked = evt.type === "chunk";
        const data = {
          type: "chunk" as const,
          /**
           * Parse the loaded data.
           * @param {Object} [initTimescale]
           * @returns {Observable}
           */
          parse(initTimescale? : number) : Observable<ISegmentParserResponse<T>> {
            const response = { data: evt.value.responseData, isChunked };
            /* tslint:disable no-unsafe-any */
            return segmentParser({ response, initTimescale, content })
            /* tslint:enable no-unsafe-any */
              .pipe(catchError((error: unknown) => {
                throw formatError(error, { defaultCode: "PIPELINE_PARSE_ERROR",
                                           defaultReason: "Unknown parsing error" });
              }));
          },
        };

        if (isChunked) {
          return observableOf(data);
        }
        return observableConcat(observableOf(data),
                                observableOf({ type: "chunk-complete" as const }));
      }),
      share() // avoid multiple side effects if multiple subs
    );
  };
}

/**
 * Construct unique ID for a single request in the RxPlayer based on a prefix
 * unique for a given loader and a `requestId` from one of that loader's
 * request.
 * @param {string} idPrefix
 * @param {string | undefined} requestId
 * @returns {string}
 */
function getFetcherId(
  idPrefix : string,
  requestId : string | undefined
) : string {
  return idPrefix + (requestId !== undefined ? "_" + requestId :
                                                     "");
}
