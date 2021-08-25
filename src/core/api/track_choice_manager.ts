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
 * This file is used to abstract the notion of text, audio and video tracks
 * switching for an easier API management.
 */

import { Subject } from "rxjs";
import log from "../../log";
import {
  Adaptation,
  Period,
  Representation,
} from "../../manifest";
import { IHDRInformation } from "../../manifest/types";
import arrayFind from "../../utils/array_find";
import assert from "../../utils/assert";
import takeFirstSet from "../../utils/take_first_set";

export interface IExposedPeriod {
  start : number;
  end : number | undefined;
  id : string;
}

/** Single preference for an audio track Adaptation. */
export type IAudioTrackPreference = null |
                                    { language? : string;
                                      audioDescription? : boolean;
                                      codec? : { all: boolean;
                                                 test: RegExp; }; };

/** Single preference for a text track Adaptation. */
export type ITextTrackPreference = null |
                                   { language : string;
                                     closedCaption : boolean; };

/** Single preference for a video track Adaptation. */
export type IVideoTrackPreference = null |
                                    IVideoTrackPreferenceObject;

/** Preference for a video track Adaptation for when it is not set to `null`. */
interface IVideoTrackPreferenceObject {
  codec? : { all: boolean;
             test: RegExp; };
  signInterpreted? : boolean;
}

/**
 * Definition of a single audio Representation as represented by the
 * TrackChoiceManager.
 */
interface ITMAudioRepresentation { id : string|number;
                                   bitrate : number;
                                   codec? : string; }

/** Audio track returned by the TrackChoiceManager. */
export interface ITMAudioTrack { language : string;
                                 normalized : string;
                                 audioDescription : boolean;
                                 dub? : boolean;
                                 id : number|string;
                                 representations: ITMAudioRepresentation[]; }

/** Text track returned by the TrackChoiceManager. */
export interface ITMTextTrack { language : string;
                                normalized : string;
                                closedCaption : boolean;
                                id : number|string; }

/**
 * Definition of a single video Representation as represented by the
 * TrackChoiceManager.
 */
interface ITMVideoRepresentation { id : string|number;
                                   bitrate : number;
                                   width? : number;
                                   height? : number;
                                   codec? : string;
                                   frameRate? : number;
                                   hdrInfo?: IHDRInformation; }

/** Video track returned by the TrackChoiceManager. */
export interface ITMVideoTrack { id : number|string;
                                 signInterpreted?: boolean;
                                 isTrickModeTrack?: boolean;
                                 trickModeTracks?: ITMVideoTrack[];
                                 representations: ITMVideoRepresentation[]; }

/** Audio track from a list of audio tracks returned by the TrackChoiceManager. */
export interface ITMAudioTrackListItem
  extends ITMAudioTrack { active : boolean }

/** Text track from a list of text tracks returned by the TrackChoiceManager. */
export interface ITMTextTrackListItem
  extends ITMTextTrack { active : boolean }

/** Video track from a list of video tracks returned by the TrackChoiceManager. */
export interface ITMVideoTrackListItem
  extends ITMVideoTrack { active : boolean }

/** Every information stored for a single Period. */
interface ITMPeriodInfos {
  /** The Period in question. */
  period : Period;
  /**
   * If `true`, this Period was present at the last `updatePeriodList` call,
   * meaning it's probably still in the Manifest.
   *
   * If `false`, this Period was not. In that case it is probably just here
   * because some audio/video/text buffer still contains data of the given type.
   */
  inManifest : boolean;
  audio : IAudioPeriodInfo;
  text : ITextPeriodInfo;
  video : IVideoPeriodInfo;

  isRemoved : boolean;
}

export interface IAudioPeriodInfo {
  /** The audio track wanted. */
  wantedTrack : Adaptation | null;
  /**
   * Last `wantedTrack` emitted through `subject`.
   * This value is mutated just before `subject` is "nexted" whereas
   * `wantedTrack` is updated as soon as we know which track is wanted.
   *
   * Having both `wantedTrack` and `lastEmittedTrack` allows to detect if some
   * potential side-effects already led to the "nexting" of `subject` with the
   * last `wantedTrack`, preventing the the `TrackChoiceManager` from doing it
   * again.
   */
  lastEmittedTrack : Adaptation | null | undefined;
  /** Subject through which the wanted track will be emitted.*/
  subject : Subject<Adaptation | null> |
            undefined;
}

export interface ITextPeriodInfo {
  /** The text track wanted. */
  wantedTrack : Adaptation | null;
  /**
   * Last `wantedTrack` emitted through `subject`.
   * This value is mutated just before `subject` is "nexted" whereas
   * `wantedTrack` is updated as soon as we know which track is wanted.
   *
   * Having both `wantedTrack` and `lastEmittedTrack` allows to detect if some
   * potential side-effects already led to the "nexting" of `subject` with the
   * last `wantedTrack`, preventing the the `TrackChoiceManager` from doing it
   * again.
   */
  lastEmittedTrack : Adaptation | null | undefined;
  /** Subject through which the wanted track will be emitted.*/
  subject : Subject<Adaptation | null> |
            undefined;
}

export interface IVideoPeriodInfo {
  /**
   * The "base" Adaptation for `wantedTrack` (if a trickmode track was chosen,
   * this is the Adaptation the trickmode track is linked to, and not the
   * trickmode track itself).
   */
  wantedTrackBase : Adaptation | null;
  /**
   * The wanted Adaptation itself (may be different from `wantedTrackBase`
   * when a trickmode track is chosen, in which case `wantedTrackBase` is
   * the Adaptation the trickmode track is linked to and `wantedTrack` is the
   * trickmode track).
   */
  wantedTrack : Adaptation | null;
  /**
   * Last `wantedTrack` emitted through `subject`.
   * This value is mutated just before `subject` is "nexted" whereas
   * `wantedTrack` is updated as soon as we know which track is wanted.
   *
   * Having both `wantedTrack` and `lastEmittedTrack` allows to detect if some
   * potential side-effects already led to the "nexting" of `subject` with the
   * last `wantedTrack`, preventing the the `TrackChoiceManager` from doing it
   * again.
   */
  lastEmittedTrack : Adaptation | null | undefined;
  /** Subject through which the wanted track will be emitted.*/
  subject : Subject<Adaptation | null> |
            undefined;
}

/**
 * Manage audio and text tracks for all active periods.
 * Choose the audio and text tracks for each period and record this choice.
 * @class TrackChoiceManager
 */
export default class TrackChoiceManager {
  /**
   * Store track selection information, per Period.
   * Sorted by Period's start time ascending
   */
  private _store : ITMPeriodInfos[];

  /** Tells if trick mode has been enabled by the RxPlayer user */
  public trickModeTrackEnabled: boolean;

  constructor(
    args : { preferTrickModeTracks: boolean }
  ) {
    this._store = [];
    this.trickModeTrackEnabled = args.preferTrickModeTracks;
  }

  /**
   * Return Array of Period information, to allow an outside application to
   * modify the track of any Period.
   * @returns {Array.<Object>}
   */
  public getAvailablePeriods() : IExposedPeriod[] {
    return this._store.map(p => {
      return { start: p.period.start,
               end: p.period.end,
               id: p.period.id };
    });
  }

  private generatePeriodInfo(
    period : Period,
    inManifest : boolean
  ) : ITMPeriodInfos {
    const audioAdaptation = period.getSupportedAdaptations("audio")[0] ?? null;
    const textAdaptation = period.getSupportedAdaptations("text")[0] ?? null;
    const baseVideoAdaptation = period.getSupportedAdaptations("video")[0] ?? null;
    const videoAdaptation = getRightVideoTrack(baseVideoAdaptation,
                                               this.trickModeTrackEnabled);
    return { period,
             inManifest,
             isRemoved: false,
             audio: { wantedTrack: audioAdaptation,
                      lastEmittedTrack: undefined,
                      subject: undefined },
             video: { wantedTrack: videoAdaptation,
                      wantedTrackBase: baseVideoAdaptation,
                      lastEmittedTrack: undefined,
                      subject: undefined },
             text: { wantedTrack: textAdaptation,
                     lastEmittedTrack: undefined,
                     subject: undefined } };
  }

  /**
   * Update the list of Periods handled by the TrackChoiceManager and make a
   * track choice decision for each of them.
   * @param {Array.<Object>} periods - The list of available periods,
   * chronologically.
   */
  public updatePeriodList(periods : Period[]) : void {
    // We assume that they are always sorted chronologically
    if (__DEV__) {
      for (let i = 1; i < periods.length; i++) {
        assert(periods[i - 1].start <= periods[i].start);
      }
    }

    // XXX TODO smarter Period eviction (keep not-so-old Periods?)

    /** Periods which have just been added. */
    const addedPeriods : ITMPeriodInfos[] = [];

    /** Tracks we have to update due to the previous one not being available anymore */
    const updatedTracks : Array<IAudioPeriodInfo |
                                ITextPeriodInfo |
                                IVideoPeriodInfo> = [];
    let newPListIdx = 0;
    for (let i = 0; i < this._store.length; i++) {
      const oldPeriod = this._store[i].period;
      const newPeriod = periods[newPListIdx];
      if (newPeriod === undefined) {
        // We reached the end of the new Periods, remove remaining old Periods
        for (let j = this._store.length - 1; j >= i; j--) {
          this._store[j].inManifest = false;
          if (isPeriodItemRemovable(this._store[j])) {
            this._store[j].isRemoved = true;
            this._store.splice(j, 1);
          }
        }
      } else if (oldPeriod === newPeriod) {
        // TODO Also check ID and replace in that case?
        newPListIdx++;

        const oldTextAdaptation = this._store[i].text.wantedTrack;
        if (oldTextAdaptation !== null) {
          const textAdaptations = newPeriod.getSupportedAdaptations("text");
          const stillHere = textAdaptations.some(a => a.id === oldTextAdaptation.id);
          if (!stillHere) {
            log.warn("TrackChoiceManager: Chosen text Adaptation not available anymore");
            const periodItem = this._store[i].text;
            periodItem.wantedTrack = textAdaptations[0] ?? null;
            updatedTracks.push(periodItem);
          }
        }
        const oldVideoAdaptation = this._store[i].video.wantedTrack;
        if (oldVideoAdaptation !== null) {
          const videoAdaptations = newPeriod.getSupportedAdaptations("video");
          const stillHere = videoAdaptations.some(a => a.id === oldVideoAdaptation.id);
          if (!stillHere) {
            log.warn("TrackChoiceManager: Chosen video Adaptation not available anymore");
            const periodItem = this._store[i].video;
            const chosenBaseTrack = videoAdaptations[0] ?? null;
            periodItem.wantedTrackBase = chosenBaseTrack;
            if (chosenBaseTrack === null) {
              periodItem.wantedTrack = null;
            } else {
              periodItem.wantedTrack = getRightVideoTrack(chosenBaseTrack,
                                                          this.trickModeTrackEnabled);

            }
            updatedTracks.push(periodItem);
          }
        }
        const oldAudioAdaptation = this._store[i].audio.wantedTrack;
        if (oldAudioAdaptation !== null) {
          const audioAdaptations = newPeriod.getSupportedAdaptations("audio");
          const stillHere = audioAdaptations.some(a => a.id === oldAudioAdaptation.id);
          if (!stillHere) {
            log.warn("TrackChoiceManager: Chosen audio Adaptation not available anymore");
            const periodItem = this._store[i].audio;
            periodItem.wantedTrack = audioAdaptations[0] ?? null;
            updatedTracks.push(periodItem);
          }
        }
        // (If not, what do?)
      } else if (oldPeriod.start <= newPeriod.start) {
        // This old Period does not exist anymore.
        this._store[i].inManifest = false;
        if (isPeriodItemRemovable(this._store[i])) {
          this._store[i].isRemoved = true;
          this._store.splice(i, 1);
          i--;
        }
      } else {
        const newPeriodInfo = this.generatePeriodInfo(newPeriod, true);
        // oldPeriod.start > newPeriod.start: insert newPeriod before
        this._store.splice(i, 0, newPeriodInfo);
        addedPeriods.push(newPeriodInfo);
        newPListIdx++;
        // Note: we don't increment `i` on purpose here, as we want to check the
        // same oldPeriod at the next loop iteration
      }
    }

    if (newPListIdx < periods.length) {
      // Add further new Period
      const periodsToAdd = periods.slice(newPListIdx)
        .map(p => this.generatePeriodInfo(p, true));
      this._store.push(...periodsToAdd);
      addedPeriods.push(...periodsToAdd);
    }

    if (updatedTracks.length > 0) {
      for (const track of  updatedTracks) {
        if (track.subject !== undefined && track.lastEmittedTrack !== track.wantedTrack) {
          track.lastEmittedTrack = track.wantedTrack;
          track.subject.next(track.wantedTrack);
        }
      }
    }

    for (const periodItem of addedPeriods) {
      if (!periodItem.isRemoved) {
        // XXX TODO emit newAvailablePeriod
      }
    }
  }

  /**
   * @param {Period} period
   * @returns {Object}
   */
  private _insertNonManifestPeriodInStore(period : Period) : ITMPeriodInfos {
    const periodInfo = this.generatePeriodInfo(period, false);
    for (let i = 0; i < this._store.length; i++) {
      if (this._store[i].period.start > period.start) {
        this._store.splice(i, 0, periodInfo);
        return periodInfo;
      }
    }
    this._store.push(periodInfo);
    return periodInfo;
  }

  /**
   * Add Subject to choose Adaptation for new "audio" or "text" Period.
   * @param {string} bufferType - The concerned buffer type
   * @param {Period} period - The concerned Period.
   * @param {Subject.<Object|null>} subject - A subject through which the
   * choice will be given
   */
  public addTrackChoiceSubject(
    bufferType : "audio" | "text"| "video",
    period : Period,
    subject : Subject<Adaptation|null>
  ) : void {
    let periodItem = getPeriodItem(this._store, period.id);
    if (periodItem === undefined) { // The Period has not yet been added.
      periodItem = this._insertNonManifestPeriodInStore(period);
      // XXX TODO emit newAvailablePeriod
    } else if (periodItem[bufferType].subject !== undefined) {
      log.error(`TrackChoiceManager: Subject already added for ${bufferType} ` +
                `and Period ${period.id}`);
      return;
    } else {
      periodItem[bufferType].subject = subject;
    }

    const choice = periodItem[bufferType].wantedTrack;
    periodItem[bufferType].lastEmittedTrack = choice;
    subject.next(choice);
  }

  /**
   * Remove Subject to choose an "audio", "video" or "text" Adaptation for a
   * Period.
   * @param {string} bufferType - The concerned buffer type
   * @param {Period} period - The concerned Period.
   */
  public removeTrackChoiceSubject(
    bufferType : "audio" | "text" | "video",
    period : Period
  ) : void {
    const periodIndex = findPeriodIndex(this._store, period);
    if (periodIndex === undefined) {
      log.warn(`TrackChoiceManager: ${bufferType} not found for period ${period.id}`);
      return;
    }

    const periodItem = this._store[periodIndex];
    const choiceItem = periodItem[bufferType];
    if (choiceItem?.subject === undefined) {
      log.warn(`TrackChoiceManager: Subject already removed for ${bufferType} ` +
               `and Period ${period.id}`);
      return;
    }

    choiceItem.subject = undefined;
    choiceItem.lastEmittedTrack = undefined;

    if (isPeriodItemRemovable(periodItem)) {
      this._store.splice(periodIndex, 1);
    }
  }

  public resetSubjects() : void {
    for (let i = 0; i < this._store.length; i++) {
      this._store[i].audio.subject = undefined;
      this._store[i].video.subject = undefined;
      this._store[i].text.subject = undefined;
    }
  }

  /**
   * Set audio track based on the ID of its adaptation for a given added Period.
   * @param {string} periodId - The concerned Period's id.
   * @param {string} wantedId - adaptation id of the wanted track
   */
  public setAudioTrackByID(periodId : string, wantedId : string) : void {
    return this._setTrackById(periodId, "audio", wantedId);
  }

  /**
   * Set text track based on the ID of its adaptation for a given added Period.
   * @param {string} periodId - The concerned Period's id.
   * @param {string} wantedId - adaptation id of the wanted track
   */
  public setTextTrackByID(periodId : string, wantedId : string) : void {
    return this._setTrackById(periodId, "text", wantedId);
  }

  /**
   * Set video track based on the ID of its adaptation for a given added Period.
   * @param {string} periodId - The concerned Period's id.
   * @param {string} wantedId - adaptation id of the wanted track
   */
  public setVideoTrackByID(periodId : string, wantedId : string) : void {
    return this._setTrackById(periodId, "video", wantedId);
  }

  /**
   * Set track based on its type and the ID of its Adaptation for a given added
   * Period.
   * @param {string} periodId - The concerned Period's id.
   * @param {string} bufferType - The type of track to set.
   * @param {string} wantedId - adaptation id of the wanted track.
   */
  private _setTrackById(
    periodId : string,
    bufferType : "audio" | "video" | "text",
    wantedId : string
  ) : void {
    const periodItem = getPeriodItem(this._store, periodId);
    if (periodItem === undefined) {
      log.warn("TrackChoiceManager: Given Period not found.");
      return;
    }

    const period = periodItem.period;
    const wantedAdaptation = arrayFind(period.getSupportedAdaptations(bufferType),
                                       ({ id }) => id === wantedId);

    if (wantedAdaptation === undefined) {
      throw new Error(`Wanted ${bufferType} track not found.`);
    }

    const typeInfo = periodItem[bufferType];
    let newAdaptation;
    if (bufferType === "video") {
      if (periodItem.video.wantedTrackBase !== wantedAdaptation) {
        periodItem.video.wantedTrackBase = wantedAdaptation;
      }
      newAdaptation = getRightVideoTrack(wantedAdaptation,
                                         this.trickModeTrackEnabled);
    } else {
      newAdaptation = wantedAdaptation;
    }
    if (typeInfo.wantedTrack === newAdaptation) {
      return;
    }
    typeInfo.wantedTrack = newAdaptation;
    if (typeInfo.subject !== undefined) {
      typeInfo.lastEmittedTrack = newAdaptation;
      typeInfo.subject.next(newAdaptation);
    }
  }

  /**
   * Disable the current text track for a given period.
   *
   * @param {string} periodId - The concerned Period's id.
   * @throws Error - Throws if the period given has not been added
   */
  public disableAudioTrack(periodId : string) : void {
    return this.disableTrack(periodId, "audio");
  }

  /**
   * Disable the current text track for a given period.
   *
   * @param {string} periodId - The concerned Period's id.
   * @throws Error - Throws if the period given has not been added
   */
  public disableTextTrack(periodId : string) : void {
    return this.disableTrack(periodId, "text");
  }

  /**
   * Disable the current text track for a given period.
   *
   * @param {string} periodId - The concerned Period's id.
   * @throws Error - Throws if the period given has not been added
   */
  public disableVideoTrack(periodId : string) : void {
    return this.disableTrack(periodId, "video");
  }

  /**
   * Disable the current text track for a given period.
   *
   * @param {string} periodId - The concerned Period's id.
   * @param {string} bufferType - The type of track to disable.
   * @throws Error - Throws if the period given has not been added
   */
  public disableTrack(
    periodId : string,
    bufferType : "audio" | "video" | "text"
  ) : void {
    const periodItem = getPeriodItem(this._store, periodId);
    if (periodItem === undefined) {
      log.warn("TrackChoiceManager: Given Period not found.");
      return;
    }

    const trackInfo = periodItem[bufferType];
    if (bufferType === "video") {
      periodItem.video.wantedTrack = null;
    }
    if (trackInfo.wantedTrack === null) {
      return;
    }

    trackInfo.wantedTrack = null;
    if (trackInfo.subject !== undefined) {
      trackInfo.lastEmittedTrack = null;
      trackInfo.subject.next(null);
    }
  }

  /**
   * @param {Object} period
   */
  public disableVideoTrickModeTracks(): void {
    if (!this.trickModeTrackEnabled) {
      return;
    }
    this.trickModeTrackEnabled = false;
    this._resetVideoTrackChoices();
  }

  /**
   * @param {Object} period
   */
  public enableVideoTrickModeTracks() : void {
    if (this.trickModeTrackEnabled) {
      return;
    }
    this.trickModeTrackEnabled = true;
    this._resetVideoTrackChoices();
  }

  private _resetVideoTrackChoices() {
    for (let i = 0; i < this._store.length; i++) {
      const periodItem = this._store[i];
      const chosenBaseTrack = periodItem.video.wantedTrackBase;
      if (chosenBaseTrack !== null) {
        const chosenTrack = getRightVideoTrack(chosenBaseTrack,
                                               this.trickModeTrackEnabled);
        periodItem.video.wantedTrackBase = chosenBaseTrack;
        periodItem.video.wantedTrack = chosenTrack;
      } else {
        periodItem.video.wantedTrackBase = null;
        periodItem.video.wantedTrack = null;
      }
    }

    // Clone the current Period list to not be influenced if Periods are removed
    // or added while the loop is running.
    const sliced = this._store.slice();
    for (let i = 0; i < sliced.length; i++) {
      const videoItem = sliced[i].video;
      if (videoItem.lastEmittedTrack !== videoItem.wantedTrack &&
          videoItem.subject !== undefined)
      {
        videoItem.lastEmittedTrack = videoItem.wantedTrack;
        videoItem.subject.next(videoItem.wantedTrack);
      }
    }
  }

  /**
   * @returns {boolean}
   */
  public isTrickModeEnabled() : boolean {
    return this.trickModeTrackEnabled;
  }

  /**
   * Returns an object describing the chosen audio track for the given audio
   * Period.
   *
   * Returns null is the the current audio track is disabled or not
   * set yet.
   *
   * @param {string} periodId - The concerned Period's id.
   * @returns {Object|null} - The audio track chosen for this Period
   */
  public getChosenAudioTrack(periodId : string) : ITMAudioTrack | null | undefined {
    const periodItem = getPeriodItem(this._store, periodId);
    if (periodItem === undefined) {
      return undefined;
    }

    const chosenTrack = periodItem.audio.wantedTrack;
    if (chosenTrack === null) {
      return null;
    }

    const audioTrack : ITMAudioTrack = {
      language: takeFirstSet<string>(chosenTrack.language, ""),
      normalized: takeFirstSet<string>(chosenTrack.normalizedLanguage, ""),
      audioDescription: chosenTrack.isAudioDescription === true,
      id: chosenTrack.id,
      representations: chosenTrack.representations.map(parseAudioRepresentation),
    };
    if (chosenTrack.isDub === true) {
      audioTrack.dub = true;
    }
    return audioTrack;
  }

  /**
   * Returns an object describing the chosen text track for the given text
   * Period.
   *
   * Returns null is the the current text track is disabled or not
   * set yet.
   *
   * @param {string} periodId - The concerned Period's id.
   * @returns {Object|null} - The text track chosen for this Period
   */
  public getChosenTextTrack(periodId : string) : ITMTextTrack | null | undefined {
    const periodItem = getPeriodItem(this._store, periodId);
    if (periodItem === undefined) {
      return undefined;
    }

    const chosenTrack = periodItem.text.wantedTrack;
    if (chosenTrack === null) {
      return null;
    }

    return {
      language: takeFirstSet<string>(chosenTrack.language, ""),
      normalized: takeFirstSet<string>(chosenTrack.normalizedLanguage, ""),
      closedCaption: chosenTrack.isClosedCaption === true,
      id: chosenTrack.id,
    };
  }

  /**
   * Returns an object describing the chosen video track for the given video
   * Period.
   *
   * Returns null is the the current video track is disabled or not
   * set yet.
   *
   * @param {string} periodId - The concerned Period's id.
   * @returns {Object|null} - The video track chosen for this Period
   */
  public getChosenVideoTrack(periodId : string) : ITMVideoTrack | null | undefined {
    const periodItem = getPeriodItem(this._store, periodId);
    if (periodItem === undefined) {
      return undefined;
    }

    const chosenTrack = periodItem.text.wantedTrack;
    if (chosenTrack === null) {
      return null;
    }

    const trickModeTracks = chosenTrack.trickModeTracks !== undefined ?
      chosenTrack.trickModeTracks.map((trickModeAdaptation) => {
        const representations = trickModeAdaptation.representations
          .map(parseVideoRepresentation);
        const trickMode : ITMVideoTrack = { id: trickModeAdaptation.id,
                                            representations,
                                            isTrickModeTrack: true };
        if (trickModeAdaptation.isSignInterpreted === true) {
          trickMode.signInterpreted = true;
        }
        return trickMode;
      }) :
      undefined;

    const videoTrack: ITMVideoTrack = {
      id: chosenTrack.id,
      representations: chosenTrack.representations.map(parseVideoRepresentation),
    };
    if (chosenTrack.isSignInterpreted === true) {
      videoTrack.signInterpreted = true;
    }
    if (chosenTrack.isTrickModeTrack === true) {
      videoTrack.isTrickModeTrack = true;
    }
    if (trickModeTracks !== undefined) {
      videoTrack.trickModeTracks = trickModeTracks;
    }
    return videoTrack;
  }

  /**
   * Returns all available audio tracks for a given Period, as an array of
   * objects.
   *
   * @param {string} periodId - The concerned Period's id.
   * @returns {Array.<Object>}
   */
  public getAvailableAudioTracks(periodId : string) : ITMAudioTrackListItem[] {
    const periodItem = getPeriodItem(this._store, periodId);
    if (periodItem === undefined) {
      return [];
    }
    const chosenAudioAdaptation = periodItem.audio.wantedTrack;
    const currentId = chosenAudioAdaptation !== null ?
      chosenAudioAdaptation.id :
      null;
    return periodItem.period.getSupportedAdaptations("audio")
      .map((adaptation) => {
        const formatted : ITMAudioTrackListItem = {
          language: takeFirstSet<string>(adaptation.language, ""),
          normalized: takeFirstSet<string>(adaptation.normalizedLanguage, ""),
          audioDescription: adaptation.isAudioDescription === true,
          id: adaptation.id,
          active: currentId === null ? false :
                                       currentId === adaptation.id,
          representations: adaptation.representations.map(parseAudioRepresentation),
        };
        if (adaptation.isDub === true) {
          formatted.dub = true;
        }
        return formatted;
      });
  }

  /**
   * Returns all available text tracks for a given Period, as an array of
   * objects.
   *
   * @param {string} periodId - The concerned Period's id.
   * @returns {Array.<Object>}
   */
  public getAvailableTextTracks(periodId : string) : ITMTextTrackListItem[] {
    const periodItem = getPeriodItem(this._store, periodId);
    if (periodItem === undefined) {
      return [];
    }

    const chosenTextAdaptation = periodItem.text.wantedTrack;
    const currentId = chosenTextAdaptation !== null ?
      chosenTextAdaptation.id :
      null;

    return periodItem.period.getSupportedAdaptations("text")
      .map((adaptation) => ({
        language: takeFirstSet<string>(adaptation.language, ""),
        normalized: takeFirstSet<string>(adaptation.normalizedLanguage, ""),
        closedCaption: adaptation.isClosedCaption === true,
        id: adaptation.id,
        active: currentId === null ? false :
                                     currentId === adaptation.id,
      }));
  }

  /**
   * Returns all available video tracks for a given Period, as an array of
   * objects.
   *
   * @param {string} periodId - The concerned Period's id.
   * @returns {Array.<Object>}
   */
  public getAvailableVideoTracks(periodId : string) : ITMVideoTrackListItem[] {
    const periodItem = getPeriodItem(this._store, periodId);
    if (periodItem === undefined) {
      return [];
    }

    const chosenVideoAdaptation = periodItem.video.wantedTrack;
    const currentId = chosenVideoAdaptation === null ?
      undefined :
      chosenVideoAdaptation.id;

    return periodItem.period.getSupportedAdaptations("video")
      .map((adaptation) => {
        const trickModeTracks = adaptation.trickModeTracks !== undefined ?
          adaptation.trickModeTracks.map((trickModeAdaptation) => {
            const isActive = currentId === null ? false :
                                                  currentId === trickModeAdaptation.id;
            const representations = trickModeAdaptation.representations
              .map(parseVideoRepresentation);
            const trickMode : ITMVideoTrackListItem = { id: trickModeAdaptation.id,
                                                        representations,
                                                        isTrickModeTrack: true,
                                                        active: isActive };
            if (trickModeAdaptation.isSignInterpreted === true) {
              trickMode.signInterpreted = true;
            }
            return trickMode;
          }) :
          undefined;

        const formatted: ITMVideoTrackListItem = {
          id: adaptation.id,
          active: currentId === null ? false :
                                       currentId === adaptation.id,
          representations: adaptation.representations.map(parseVideoRepresentation),
        };
        if (adaptation.isSignInterpreted === true) {
          formatted.signInterpreted = true;
        }
        if (trickModeTracks !== undefined) {
          formatted.trickModeTracks = trickModeTracks;
        }
        return formatted;
      });
  }
}

/**
 * Returns the index of the given `period` in the given `periods`
 * Array.
 * Returns `undefined` if that `period` is not found.
 * @param {Object} periods
 * @param {Object} period
 * @returns {number|undefined}
 */
function findPeriodIndex(
  periods : ITMPeriodInfos[],
  period : Period
) : number|undefined {
  for (let i = 0; i < periods.length; i++) {
    const periodI = periods[i];
    if (periodI.period.id === period.id) {
      return i;
    }
  }
}

/**
 * Returns element in the given `periods` Array that corresponds to the
 * `period` given.
 * Returns `undefined` if that `period` is not found.
 * @param {Object} periods
 * @param {string} periodId
 * @returns {Object|undefined}
 */
function getPeriodItem(
  periods : ITMPeriodInfos[],
  periodId : string
) : ITMPeriodInfos|undefined {
  for (let i = 0; i < periods.length; i++) {
    const periodI = periods[i];
    if (periodI.period.id === periodId) {
      return periodI;
    }
  }
}

/**
 * Parse video Representation into a ITMVideoRepresentation.
 * @param {Object} representation
 * @returns {Object}
 */
function parseVideoRepresentation(
  { id, bitrate, frameRate, width, height, codec, hdrInfo } : Representation
) : ITMVideoRepresentation {
  return { id, bitrate, frameRate, width, height, codec, hdrInfo };
}

/**
 * A `ITMPeriodInfos` should only be removed once all subjects linked to it do
 * not exist anymore, to keep the possibility of making track choices.
 * @param {Object} periodItem
 * @returns {boolean}
 */
function isPeriodItemRemovable(
  periodItem : ITMPeriodInfos
) : boolean {
  // XXX TODO Keep for some time
  return !periodItem.inManifest &&
         periodItem.text?.subject === undefined &&
         periodItem.audio?.subject === undefined &&
         periodItem.video?.subject === undefined;
}

/**
 * Parse audio Representation into a ITMAudioRepresentation.
 * @param {Object} representation
 * @returns {Object}
 */
function parseAudioRepresentation(
  { id, bitrate, codec } : Representation
)  : ITMAudioRepresentation {
  return { id, bitrate, codec };
}

function getRightVideoTrack(
  adaptation : Adaptation,
  isTrickModeEnabled : boolean
) : Adaptation {
  if (isTrickModeEnabled &&
      adaptation.trickModeTracks?.[0] !== undefined)
  {
    return adaptation.trickModeTracks[0];
  }
  return adaptation;
}
