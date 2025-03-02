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

import PPromise from "pinkie";
import features from "../../features";
import log from "../../log";
import Manifest from "../../manifest";
import { IDashParserResponse } from "../../parsers/manifest/dash/parsers_types";
import objectAssign from "../../utils/object_assign";
import request from "../../utils/request";
import {
  strToUtf8,
  utf8ToStr,
} from "../../utils/string_parsing";
import { CancellationSignal } from "../../utils/task_canceller";
import {
  IManifestParserOptions,
  IManifestParserRequestScheduler,
  IManifestParserResult,
  IRequestedData,
  ITransportOptions,
} from "../types";

export default function generateManifestParser(
  options : ITransportOptions
) : (
    manifestData : IRequestedData<unknown>,
    parserOptions : IManifestParserOptions,
    onWarnings : (warnings : Error[]) => void,
    cancelSignal : CancellationSignal,
    scheduleRequest : IManifestParserRequestScheduler
  ) => IManifestParserResult | Promise<IManifestParserResult>
{
  const { aggressiveMode,
          referenceDateTime } = options;
  const serverTimeOffset = options.serverSyncInfos !== undefined ?
    options.serverSyncInfos.serverTimestamp - options.serverSyncInfos.clientTime :
    undefined;
  return function manifestParser(
    manifestData : IRequestedData<unknown>,
    parserOptions : IManifestParserOptions,
    onWarnings : (warnings : Error[]) => void,
    cancelSignal : CancellationSignal,
    scheduleRequest : IManifestParserRequestScheduler
  ) : IManifestParserResult | Promise<IManifestParserResult> {
    const { responseData } = manifestData;
    const argClockOffset = parserOptions.externalClockOffset;
    const url = manifestData.url ?? parserOptions.originalUrl;

    const optAggressiveMode = aggressiveMode === true;
    const externalClockOffset = serverTimeOffset ?? argClockOffset;
    const unsafelyBaseOnPreviousManifest = parserOptions.unsafeMode ?
      parserOptions.previousManifest :
      null;
    const dashParserOpts = { aggressiveMode: optAggressiveMode,
                             unsafelyBaseOnPreviousManifest,
                             url,
                             referenceDateTime,
                             externalClockOffset };

    const parsers = features.dashParsers;
    if (parsers.wasm === null ||
        parsers.wasm.status === "uninitialized" ||
        parsers.wasm.status === "failure")
    {
      log.debug("DASH: WASM MPD Parser not initialized. Running JS one.");
      return runDefaultJsParser();
    } else {
      const manifestAB = getManifestAsArrayBuffer(responseData);
      if (!doesXmlSeemsUtf8Encoded(manifestAB)) {
        log.info("DASH: MPD doesn't seem to be UTF-8-encoded. " +
                 "Running JS parser instead of the WASM one.");
        return runDefaultJsParser();
      }

      if (parsers.wasm.status === "initialized") {
        log.debug("DASH: Running WASM MPD Parser.");
        const parsed = parsers.wasm.runWasmParser(manifestAB, dashParserOpts);
        return processMpdParserResponse(parsed);
      } else {
        log.debug("DASH: Awaiting WASM initialization before parsing the MPD.");
        const initProm = parsers.wasm.waitForInitialization()
          .catch(() => { /* ignore errors, we will check the status later */ });
        return initProm.then(() => {
          if (parsers.wasm === null || parsers.wasm.status !== "initialized") {
            log.warn("DASH: WASM MPD parser initialization failed. " +
                     "Running JS parser instead");
            return runDefaultJsParser();
          }
          log.debug("DASH: Running WASM MPD Parser.");
          const parsed = parsers.wasm.runWasmParser(manifestAB, dashParserOpts);
          return processMpdParserResponse(parsed);
        });
      }
    }

    /**
     * Parse the MPD through the default JS-written parser (as opposed to the
     * WebAssembly one).
     * If it is not defined, throws.
     * @returns {Observable}
     */
    function runDefaultJsParser() {
      if (parsers.js === null) {
        throw new Error("No MPD parser is imported");
      }
      const manifestDoc = getManifestAsDocument(responseData);
      const parsedManifest = parsers.js(manifestDoc, dashParserOpts);
      return processMpdParserResponse(parsedManifest);
    }

    /**
     * Process return of one of the MPD parser.
     * If it asks for a resource, load it then continue.
     * @param {Object} parserResponse - Response returned from a MPD parser.
     * @returns {Observable}
     */
    function processMpdParserResponse(
      parserResponse : IDashParserResponse<string> | IDashParserResponse<ArrayBuffer>
    ) : IManifestParserResult | Promise<IManifestParserResult> {
      if (parserResponse.type === "done") {
        if (parserResponse.value.warnings.length > 0) {
          onWarnings(parserResponse.value.warnings);
        }
        if (cancelSignal.isCancelled) {
          return PPromise.reject(cancelSignal.cancellationError);
        }
        const manifest = new Manifest(parserResponse.value.parsed, options);
        return { manifest, url };
      }

      const { value } = parserResponse;

      const externalResources = value.urls.map(resourceUrl => {
        return scheduleRequest(() => {
          const req = value.format === "string" ?
            request({ url: resourceUrl,
                      responseType: "text" as const,
                      cancelSignal }) :
            request({ url: resourceUrl,
                      responseType: "arraybuffer" as const,
                      cancelSignal });
          return req;
        });
      });

      return PPromise.all(externalResources).then(loadedResources => {
        if (value.format === "string") {
          const resources = loadedResources.map(resource => {
            if (typeof resource.responseData !== "string") {
              throw new Error("External DASH resources should have been a string");
            }
            // Normally not needed but TypeScript is just dumb here
            return objectAssign(resource, { responseData: resource.responseData });
          });
          return processMpdParserResponse(value.continue(resources));
        } else {
          const resources = loadedResources.map(resource => {
            if (!(resource.responseData instanceof ArrayBuffer)) {
              throw new Error("External DASH resources should have been ArrayBuffers");
            }
            // Normally not needed but TypeScript is just dumb here
            return objectAssign(resource, { responseData: resource.responseData });
          });
          return processMpdParserResponse(value.continue(resources));
        }
      });
    }
  };
}

/**
 * Try to convert a Manifest from an unknown format to a `Document` format.
 * Useful to exploit DOM-parsing APIs to quickly parse an XML Manifest.
 *
 * Throws if the format cannot be converted.
 * @param {*} manifestSrc
 * @returns {Document}
 */
function getManifestAsDocument(manifestSrc : unknown) : Document {
  if (manifestSrc instanceof ArrayBuffer) {
    return new DOMParser()
      .parseFromString(utf8ToStr(new Uint8Array(manifestSrc)), "text/xml");
  } else if (typeof manifestSrc === "string") {
    return new DOMParser().parseFromString(manifestSrc, "text/xml");
  } else if (manifestSrc instanceof Document) {
    return manifestSrc;
  } else {
    throw new Error("DASH Manifest Parser: Unrecognized Manifest format");
  }
}

/**
 * Try to convert a Manifest from an unknown format to an `ArrayBuffer` format.
 * Throws if the format cannot be converted.
 * @param {*} manifestSrc
 * @returns {ArrayBuffer}
 */
function getManifestAsArrayBuffer(manifestSrc : unknown) : ArrayBuffer {
  if (manifestSrc instanceof ArrayBuffer) {
    return manifestSrc;
  } else if (typeof manifestSrc === "string") {
    return strToUtf8(manifestSrc).buffer;
  } else if (manifestSrc instanceof Document) {
    return strToUtf8(manifestSrc.documentElement.innerHTML).buffer;
  } else {
    throw new Error("DASH Manifest Parser: Unrecognized Manifest format");
  }
}

/**
 * Returns true if the given XML appears to be encoded in UTF-8.
 *
 * For now, this function can return a lot of false positives, but it should
 * mostly work with real use cases.
 * @param {ArrayBuffer} xmlData
 * @returns {boolean}
 */
function doesXmlSeemsUtf8Encoded(
  xmlData : ArrayBuffer
) : boolean {
  const dv = new DataView(xmlData);
  if (dv.getUint16(0) === 0xEFBB && dv.getUint8(2) === 0XBF) {
    // (UTF-8 BOM)
    return true;
  } else if (dv.getUint16(0) === 0xFEFF || dv.getUint16(0) === 0xFFFe) {
    // (UTF-16 BOM)
    return false;
  }

  // TODO check encoding from request mimeType and text declaration?
  // https://www.w3.org/TR/xml/#sec-TextDecl
  return true;
}
