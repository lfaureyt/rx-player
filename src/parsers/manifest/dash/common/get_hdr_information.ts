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

/**
 * Information about the HDR characteristic of a content.
 */
export interface IParsedWEBMHDRInformation {
  /**
   * It is the bit depth used for encoding color for a pixel.
   *
   * It is used to ask to the user agent if the color depth is supported by the
   * output device.
   */
  colorDepth: number;
  /**
   * It is the HDR eotf. It is the transfer function having the video signal as
   * input and converting it into the linear light output of the display. The
   * conversion is done within the display device.
   *
   * It may be used here to ask the MediaSource if it supported.
   */
  eotf: "pq" | "hlg";
  /**
   * It is the video color space used for encoding. An HDR content may not have
   * a wide color gamut.
   *
   * It may be used to ask about output device color space support.
   */
  colorSpace?: "rec2020";
}

/**
 * Extract the webm HDR information out of the codec string.
 * The syntax of the codec string is defined in VP Codec ISO Media File Format
 * Binding, in the section Codecs Parameter String.
 * @param {string} codecString
 * @returns {Object | undefined}
 */
export function getWEBMHDRInformation(
  codecString: string
): undefined | IParsedWEBMHDRInformation {
  // cccc.PP.LL.DD.CC[.cp[.tc[.mc[.FF]]]]
  const [cccc, _PP, _LL, DD, _CC, cp, tc, mc] = codecString.split(".");
  if (cccc !== "vp08" &&
      cccc !== "vp09" &&
      cccc !== "vp10") {
    return undefined;
  }

  let colorDepth: number | undefined;
  let eotf: "pq" | "hlg" | undefined;
  let colorSpace: "rec2020" | undefined;

  if (DD !== undefined &&
      DD === "10" ||
      DD === "12") {
    colorDepth = parseInt(DD, 10);
  }

  if (tc !== undefined) {
    if (tc === "16") {
      eotf = "pq";
    } else if (tc === "18") {
      eotf = "hlg";
    }
  }

  if (cp !== undefined &&
      mc !== undefined &&
      cp === "09" &&
      mc === "09") {
    colorSpace = "rec2020";
  }

  if (colorDepth === undefined ||
      eotf === undefined) {
    return undefined;
  }

  return { colorDepth, eotf, colorSpace };
}
