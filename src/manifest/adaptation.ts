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

import { IParsedAdaptation } from "../parsers/manifest";
import arrayFind from "../utils/array_find";
import isNullOrUndefined from "../utils/is_null_or_undefined";
import normalizeLanguage from "../utils/languages";
import uniq from "../utils/uniq";
import Representation from "./representation";
import {
  IAdaptationType,
  IExposedRepresentation,
} from "./types";

/** List in an array every possible value for the Adaptation's `type` property. */
export const SUPPORTED_ADAPTATIONS_TYPE: IAdaptationType[] = [ "audio",
                                                               "video",
                                                               "text",
                                                               "image" ];

/**
 * Information describing a single Representation from an Adaptation, to be used
 * in the `representationFilter` API.
 */
export interface IRepresentationInfos { bufferType: IAdaptationType;
                                        language?: string | undefined;
                                        isAudioDescription? : boolean | undefined;
                                        isClosedCaption? : boolean | undefined;
                                        isDub? : boolean | undefined;
                                        isSignInterpreted?: boolean | undefined;
                                        normalizedLanguage? : string | undefined; }

/** Type for the `representationFilter` API. */
export type IRepresentationFilter = (representation: IExposedRepresentation,
                                     adaptationInfos: IRepresentationInfos) => boolean;

/**
 * Normalized Adaptation structure.
 * An Adaptation describes a single `Track`. For example a specific audio
 * track (in a given language) or a specific video track.
 * It istelf can be represented in different qualities, which we call here
 * `Representation`.
 * @class Adaptation
 */
export default class Adaptation {
  /** ID uniquely identifying the Adaptation in the Period. */
  public readonly id : string;

  /**
   * Different `Representations` (e.g. qualities) this Adaptation is available
   * in.
   */
  public readonly representations : Representation[];

  /** Type of this Adaptation. */
  public readonly type : IAdaptationType;

  /** Whether this track contains an audio description for the visually impaired. */
  public isAudioDescription? : boolean;

  /** Whether this Adaptation contains closed captions for the hard-of-hearing. */
  public isClosedCaption? : boolean;

  /** If true this Adaptation contains sign interpretation. */
  public isSignInterpreted? : boolean;

  /**
   * If `true`, this Adaptation is a "dub", meaning it was recorded in another
   * language than the original one.
   */
  public isDub? : boolean;

  /** Language this Adaptation is in, as announced in the original Manifest. */
  public language? : string;

  /** Language this Adaptation is in, when translated into an ISO639-3 code. */
  public normalizedLanguage? : string;

  /**
   * `true` if this Adaptation was not present in the original Manifest, but was
   * manually added after through the corresponding APIs.
   */
  public manuallyAdded? : boolean;

  /** `true` if at least one Representation is in a supported codec. `false` otherwise. */
  public isSupported : boolean;

  /** Tells if the track is a trick mode track. */
  public isTrickModeTrack? : boolean;

  public readonly trickModeTracks? : Adaptation[];

  /**
   * @constructor
   * @param {Object} parsedAdaptation
   * @param {Object|undefined} [options]
   */
  constructor(parsedAdaptation : IParsedAdaptation, options : {
    representationFilter? : IRepresentationFilter;
    isManuallyAdded? : boolean;
  } = {}) {
    const { trickModeTracks } = parsedAdaptation;
    const { representationFilter, isManuallyAdded } = options;
    this.id = parsedAdaptation.id;
    this.isTrickModeTrack = parsedAdaptation.isTrickModeTrack;

    this.type = parsedAdaptation.type;

    if (parsedAdaptation.language !== undefined) {
      this.language = parsedAdaptation.language;
      this.normalizedLanguage = normalizeLanguage(parsedAdaptation.language);
    }

    if (parsedAdaptation.closedCaption !== undefined) {
      this.isClosedCaption = parsedAdaptation.closedCaption;
    }
    if (parsedAdaptation.audioDescription !== undefined) {
      this.isAudioDescription = parsedAdaptation.audioDescription;
    }
    if (parsedAdaptation.isDub !== undefined) {
      this.isDub = parsedAdaptation.isDub;
    }
    if (parsedAdaptation.isSignInterpreted !== undefined) {
      this.isSignInterpreted = parsedAdaptation.isSignInterpreted;
    }

    if (trickModeTracks !== undefined &&
        trickModeTracks.length > 0) {
      this.trickModeTracks = trickModeTracks.map((track) => new Adaptation(track));
    }

    const argsRepresentations = parsedAdaptation.representations;
    const representations : Representation[] = [];
    let isSupported : boolean = false;
    for (let i = 0; i < argsRepresentations.length; i++) {
      const representation = new Representation(argsRepresentations[i],
                                                { type: this.type });
      const shouldAdd =
        isNullOrUndefined(representationFilter) ||
        representationFilter(representation,
                             { bufferType: this.type,
                               language: this.language,
                               normalizedLanguage: this.normalizedLanguage,
                               isClosedCaption: this.isClosedCaption,
                               isDub: this.isDub,
                               isAudioDescription: this.isAudioDescription,
                               isSignInterpreted: this.isSignInterpreted });
      if (shouldAdd) {
        representations.push(representation);
        if (!isSupported && representation.isSupported) {
          isSupported = true;
        }
      }
    }
    representations.sort((a, b) => a.bitrate - b.bitrate);
    this.representations = representations;

    this.isSupported = isSupported;

    // for manuallyAdded adaptations (not in the manifest)
    this.manuallyAdded = isManuallyAdded === true;
  }

  /**
   * Returns unique bitrate for every Representation in this Adaptation.
   * @returns {Array.<Number>}
   */
  getAvailableBitrates() : number[] {
    const bitrates : number[] = [];
    for (let i = 0; i < this.representations.length; i ++) {
      const representation = this.representations[i];
      if (representation.decipherable !== false) {
        bitrates.push(representation.bitrate);
      }
    }
    return uniq(bitrates);
  }

  /**
   * Returns all Representation in this Adaptation that can be played (that is:
   * not undecipherable and with a supported codec).
   * @returns {Array.<Representation>}
   */
  getPlayableRepresentations() : Representation[] {
    return this.representations.filter(rep => {
      return rep.isSupported && rep.decipherable !== false;
    });
  }

  /**
   * Returns the Representation linked to the given ID.
   * @param {number|string} wantedId
   * @returns {Object|undefined}
   */
  getRepresentation(wantedId : number|string) : Representation|undefined {
    return arrayFind(this.representations, ({ id }) => wantedId === id);
  }
}
