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
  getMDHDTimescale,
  getSegmentsFromSidx,
} from "../../parsers/containers/isobmff";
import { BaseRepresentationIndex } from "../../parsers/manifest/dash";
import assert from "../../utils/assert";
import {
  strToUtf8,
  utf8ToStr,
} from "../../utils/string_parsing";
import takeFirstSet from "../../utils/take_first_set";
import {
  ISegmentContext,
  ISegmentParser,
  ISegmentParserParsedInitSegment,
  ISegmentParserParsedSegment,
  ITextTrackSegmentData,
} from "../types";
import getISOBMFFTimingInfos from "../utils/get_isobmff_timing_infos";
import isMP4EmbeddedTextTrack from "../utils/is_mp4_embedded_text_track";
import {
  getISOBMFFEmbeddedTextTrackData,
  getPlainTextTrackData,
} from "../utils/parse_text_track";

/**
 * Parse TextTrack data when it is embedded in an ISOBMFF file.
 * @param {Object} infos
 * @returns {Observable.<Object>}
 */
function parseISOBMFFEmbeddedTextTrack(
  loadedSegment : { data : ArrayBuffer | Uint8Array | string | null;
                    isChunked : boolean; },
  content : ISegmentContext,
  initTimescale : number | undefined,
  __priv_patchLastSegmentInSidx? : boolean
) : ISegmentParserParsedSegment< ITextTrackSegmentData | null > |
    ISegmentParserParsedInitSegment< null > {
  const { period, representation, segment } = content;
  const { isInit, indexRange } = segment;
  const { data, isChunked } = loadedSegment;

  // Should already have been taken care of
  // TODO better use TypeScript here?
  assert(data !== null);

  const chunkBytes = typeof data === "string"   ? strToUtf8(data) :
                     data instanceof Uint8Array ? data :
                                                  new Uint8Array(data);
  if (isInit) {
    const sidxSegments =
      getSegmentsFromSidx(chunkBytes, Array.isArray(indexRange) ? indexRange[0] :
                                                                  0);

    // This is a very specific handling for streams we know have a very
    // specific problem at Canal+: The last reference gives a truncated
    // segment.
    // Sadly, people on the packaging side could not fix all legacy contents.
    // This is an easy-but-ugly fix for those.
    // TODO Cleaner way? I tried to always check the obtained segment after
    // a byte-range request but it leads to a lot of code.
    if (__priv_patchLastSegmentInSidx === true &&
        sidxSegments !== null &&
        sidxSegments.length > 0)
    {
      const lastSegment = sidxSegments[ sidxSegments.length - 1 ];
      if (Array.isArray(lastSegment.range)) {
        lastSegment.range[1] = Infinity;
      }
    }

    const mdhdTimescale = getMDHDTimescale(chunkBytes);
    if (representation.index instanceof BaseRepresentationIndex &&
        sidxSegments !== null &&
        sidxSegments.length > 0)
    {
      representation.index._addSegments(sidxSegments);
    }
    return { segmentType: "init",
             initializationData: null,
             protectionDataUpdate: false,
             initTimescale: mdhdTimescale };
  }
  const chunkInfos = getISOBMFFTimingInfos(chunkBytes,
                                           isChunked,
                                           segment,
                                           initTimescale);
  const chunkData = getISOBMFFEmbeddedTextTrackData(content,
                                                    chunkBytes,
                                                    chunkInfos,
                                                    isChunked);
  const chunkOffset = takeFirstSet<number>(segment.timestampOffset, 0);
  return { segmentType: "media",
           chunkData,
           chunkInfos,
           chunkOffset,
           appendWindow: [period.start, period.end] };
}

/**
 * Parse TextTrack data in plain text form.
 * @param {Object} infos
 * @returns {Observable.<Object>}
 */
function parsePlainTextTrack(
  loadedSegment : { data : ArrayBuffer | Uint8Array | string | null;
                    isChunked : boolean; },
  content : ISegmentContext
) : ISegmentParserParsedSegment< ITextTrackSegmentData | null > |
    ISegmentParserParsedInitSegment< null > {
  const { period, segment } = content;
  const { timestampOffset = 0 } = segment;
  if (segment.isInit) {
    return { segmentType: "init",
             initializationData: null,
             protectionDataUpdate: false,
             initTimescale: undefined };
  }

  const { data, isChunked } = loadedSegment;
  assert(data !== null);
  let textTrackData : string;
  if (typeof data !== "string") {

    // Should already have been taken care of
    // TODO better use TypeScript here?
    assert(data !== null);

    const bytesData = data instanceof Uint8Array ? data :
                                                   new Uint8Array(data);
    textTrackData = utf8ToStr(bytesData);
  } else {
    textTrackData = data;
  }
  const chunkData = getPlainTextTrackData(content, textTrackData, isChunked);
  return { segmentType: "media",
           chunkData,
           chunkInfos: null,
           chunkOffset: timestampOffset,
           appendWindow: [period.start, period.end] };
}

/**
 * @param {Object} config
 * @returns {Function}
 */
export default function generateTextTrackParser(
  { __priv_patchLastSegmentInSidx } : { __priv_patchLastSegmentInSidx? : boolean }
) : ISegmentParser< ArrayBuffer | Uint8Array | string | null,
                    ITextTrackSegmentData | null > {
  /**
   * Parse TextTrack data.
   * @param {Object} infos
   * @returns {Observable.<Object>}
   */
  return function textTrackParser(
    loadedSegment : { data : ArrayBuffer | Uint8Array | string | null;
                      isChunked : boolean; },
    content : ISegmentContext,
    initTimescale : number | undefined
  ) : ISegmentParserParsedSegment< ITextTrackSegmentData | null > |
      ISegmentParserParsedInitSegment< null > {
    const { period, representation, segment } = content;
    const { timestampOffset = 0 } = segment;
    const { data } = loadedSegment;
    if (data === null) { // No data, just return empty infos
      if (segment.isInit) {
        return { segmentType: "init",
                 initializationData: null,
                 protectionDataUpdate: false,
                 initTimescale: undefined };
      }
      return { segmentType: "media",
               chunkData: null,
               chunkInfos: null,
               chunkOffset: timestampOffset,
               appendWindow: [period.start, period.end] };
    }

    const isMP4 = isMP4EmbeddedTextTrack(representation);
    if (isMP4) {
      return parseISOBMFFEmbeddedTextTrack(loadedSegment,
                                           content,
                                           initTimescale,
                                           __priv_patchLastSegmentInSidx);
    } else {
      return parsePlainTextTrack(loadedSegment, content);
    }
  };
}
