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
  defer as observableDefer,
  fromEvent as observableFromEvent,
  interval as observableInterval,
  merge as observableMerge,
  Observable,
} from "rxjs";
import {
  map,
  mapTo,
  share,
  startWith,
} from "rxjs/operators";
import config from "../../config";
import log from "../../log";
import objectAssign from "../../utils/object_assign";
import { getRange } from "../../utils/ranges";

const { SAMPLING_INTERVAL_MEDIASOURCE,
        SAMPLING_INTERVAL_LOW_LATENCY,
        SAMPLING_INTERVAL_NO_MEDIASOURCE,
        RESUME_GAP_AFTER_SEEKING,
        RESUME_GAP_AFTER_NOT_ENOUGH_DATA,
        RESUME_GAP_AFTER_BUFFERING,
        REBUFFERING_GAP,
        MINIMUM_BUFFER_AMOUNT_BEFORE_FREEZING } = config;

/**
 * HTMLMediaElement Events for which playback observations are calculated and
 * emitted.
 * @type {Array.<string>}
 */
const SCANNED_MEDIA_ELEMENTS_EVENTS : IPlaybackObserverEventType[] = [ "canplay",
                                                                       "play",
                                                                       "seeking",
                                                                       "seeked",
                                                                       "loadedmetadata",
                                                                       "ratechange" ];

/**
 * Class allowing to "observe" current playback conditions so the RxPlayer is
 * then able to react upon them.
 *
 * This is a central class of the RxPlayer as many modules rely on the
 * `PlaybackObserver` to know the current state of the media being played.
 *
 * You can use the PlaybackObserver to either get the last observation
 * performed, get the current media state or subscribe to an Observable emitting
 * regularly media conditions.
 *
 * @class {PlaybackObserver}
 */
export default class PlaybackObserver {

  /** HTMLMediaElement which we want to observe. */
  private _mediaElement : HTMLMediaElement;

  /** If `true`, a `MediaSource` object is linked to `_mediaElement`. */
  private _withMediaSource : boolean;

  /**
   * If `true`, we're playing in a low-latency mode, which might have an
   * influence on some chosen interval values here.
   */
  private _lowLatencyMode : boolean;

  /**
   * The RxPlayer usually wants to differientate when a seek was sourced from
   * the RxPlayer's internal logic vs when it was sourced from an outside
   * application code.
   *
   * To implement this in the PlaybackObserver, we maintain this counter
   * allowing to know when a "seeking" event received from a `HTMLMediaElement`
   * was due to an "internal seek" or an external seek:
   *   - This counter is incremented each time an "internal seek" (seek from the
   *     inside of the RxPlayer has been performed.
   *   - This counter is decremented each time we received a "seeking" event.
   *
   * This allows us to correctly characterize seeking events: if the counter is
   * superior to `0`, it is probably due to an internal "seek".
   */
  private _internalSeekingEventsIncomingCounter : number;

  /** Last playback observation made by the `PlaybackObserver`. */
  private _lastObservation : IPlaybackObservation;

  private _observation$ : Observable<IPlaybackObservation> | null;

  /**
   * @param {HTMLMediaElement} mediaElement
   * @param {Object} options
   */
  constructor(mediaElement : HTMLMediaElement, options : IPlaybackObserverOptions) {
    this._internalSeekingEventsIncomingCounter = 0;
    this._mediaElement = mediaElement;
    this._withMediaSource = options.withMediaSource;
    this._lowLatencyMode = options.lowLatencyMode;
    this._lastObservation = objectAssign(getMediaInfos(this._mediaElement, "init"),
                                         { rebuffering: null,
                                           freezing: null });
    this._observation$ = null;
  }

  // XXX TODO Observation => Sample?
  public getLastObservation() : IPlaybackObservation {
    return this._lastObservation;
  }

  public getCurrentTime() : number {
    return this._mediaElement.currentTime;
  }

  public setCurrentTime(time: number) : void {
    this._internalSeekingEventsIncomingCounter += 1;
    this._mediaElement.currentTime = time;
  }

  // XXX TODO Make hot?
  public listen(includeLastObservation : boolean) : Observable<IPlaybackObservation> {
    return observableDefer(() => {
      let observation$ = this._observation$;
      if (observation$ === null) {
        observation$ = this._createObservationObservable().pipe(share());
        this._observation$ = observation$;
      }
      return includeLastObservation ?
        observation$.pipe(startWith(this.getLastObservation())) :
        observation$;
    });
  }

  private _createObservationObservable() : Observable<IPlaybackObservation> {
    return observableDefer(() : Observable<IPlaybackObservation> => {
      const getCurrentObservation = (
        event : IPlaybackObserverEventType
      ) : IPlaybackObservation => {
        let tmpEvt: IPlaybackObserverEventType = event;
        if (tmpEvt === "seeking" && this._internalSeekingEventsIncomingCounter > 0) {
          tmpEvt = "internal-seeking";
          this._internalSeekingEventsIncomingCounter -= 1;
        }
        const mediaTimings = getMediaInfos(this._mediaElement, tmpEvt);
        const rebufferingStatus = getRebufferingStatus(
          this._lastObservation,
          mediaTimings,
          { lowLatencyMode: this._lowLatencyMode,
            withMediaSource: this._withMediaSource });

        const freezingStatus = getFreezingStatus(this._lastObservation, mediaTimings);
        const timings = objectAssign(
          {},
          { rebuffering: rebufferingStatus,
            freezing: freezingStatus },
          mediaTimings);
        log.debug("API: current media element state", timings);
        return timings;
      };

      const eventObs : Array< Observable< IPlaybackObserverEventType > > =
        SCANNED_MEDIA_ELEMENTS_EVENTS.map((eventName) =>
          observableFromEvent(this._mediaElement, eventName)
            .pipe(mapTo(eventName)));

      const interval = this._lowLatencyMode  ? SAMPLING_INTERVAL_LOW_LATENCY :
                       this._withMediaSource ? SAMPLING_INTERVAL_MEDIASOURCE :
                                               SAMPLING_INTERVAL_NO_MEDIASOURCE;

      const interval$ : Observable<"timeupdate"> =
        observableInterval(interval)
          .pipe(mapTo("timeupdate"));

      return observableMerge(interval$, ...eventObs).pipe(
        map((event : IPlaybackObserverEventType) => {
          const newObservation = getCurrentObservation(event);
          if (log.getLevel() === "DEBUG") {
            log.debug("API: current playback timeline:\n" +
                      prettyPrintBuffered(newObservation.buffered,
                                          newObservation.position),
                      `\n${event}`);
          }
          this._lastObservation = newObservation;
          return newObservation;
        }));
    });
  }
}

/** "Event" that triggered the playback observation. */
export type IPlaybackObserverEventType =
  /** First playback observation automatically emitted. */
  "init" | // set once on first emit
  /** Regularly emitted playback observation when no event happened in a long time. */
  "timeupdate" |
  /** On the HTML5 event with the same name */
  "canplay" |
  /** On the HTML5 event with the same name */
  "canplaythrough" | // HTML5 Event
  /** On the HTML5 event with the same name */
  "play" |
  /** On the HTML5 event with the same name */
  "seeking" |
  /** On the HTML5 event with the same name */
  "seeked" |
  /** On the HTML5 event with the same name */
  "stalled" |
  /** On the HTML5 event with the same name */
  "loadedmetadata" |
  /** On the HTML5 event with the same name */
  "ratechange" |
  /** An internal seek happens */
  "internal-seeking";

/** Information recuperated on the media element on each playback observation. */
interface IMediaInfos {
  /** Gap between `currentTime` and the next position with un-buffered data. */
  bufferGap : number;
  /** Value of `buffered` (buffered ranges) for the media element. */
  buffered : TimeRanges;
  /** The buffered range we are currently playing. */
  currentRange : { start : number;
                   end : number; } |
                 null;
  /**
   * `currentTime` (position) set on the media element at the time of the
   * PlaybackObserver's measure.
   */
  position : number;
  /** Current `duration` set on the media element. */
  duration : number;
  /** Current `ended` set on the media element. */
  ended: boolean;
  /** Current `paused` set on the media element. */
  paused : boolean;
  /** Current `playbackRate` set on the media element. */
  playbackRate : number;
  /** Current `readyState` value on the media element. */
  readyState : number;
  /** Current `seeking` value on the mediaElement. */
  seeking : boolean;
   /** Event that triggered this playback observation. */
  event : IPlaybackObserverEventType;
}

/**
 * Describes when the player is "rebuffering" and what event started that
 * status.
 * "Rebuffering" is a status where the player has not enough buffer ahead to
 * play reliably.
 * The RxPlayer should pause playback when a playback observation indicates the
 * rebuffering status.
 */
export interface IRebufferingStatus {
  /** What started the player to rebuffer. */
  reason : "seeking" | // Building buffer after seeking
           "not-ready" | // Building buffer after low readyState
           "internal-seek" | // Building buffer after a seek happened inside the player
           "buffering"; // Other cases
  /** `performance.now` at the time the rebuffering happened. */
  timestamp : number;
  /**
   * Position, in seconds, at which data is awaited.
   * If `null` the player is rebuffering but not because it is awaiting future data.
   */
  position : number | null;
}

/**
 * Describes when the player is "frozen".
 * This status is reserved for when the player is stuck at the same position for
 * an unknown reason.
 */
export interface IFreezingStatus {
  /** `performance.now` at the time the freezing started to be detected. */
  timestamp : number;
}

/** Information emitted on each playback observation. */
export interface IPlaybackObservation extends IMediaInfos {
  /**
   * Set if the player is short on audio and/or video media data and is a such,
   * rebuffering.
   * `null` if not.
   */
  rebuffering : IRebufferingStatus | null;
  /**
   * Set if the player is frozen, that is, stuck in place for unknown reason.
   * Note that this reason can be a valid one, such as a necessary license not
   * being obtained yet.
   *
   * `null` if the player is not frozen.
   */
  freezing : IFreezingStatus | null;
}

/**
 * Returns the amount of time in seconds the buffer should have ahead of the
 * current position before resuming playback. Based on the infos of the
 * rebuffering status.
 *
 * Waiting time differs between a rebuffering happening after a "seek" or one
 * happening after a buffer starvation occured.
 * @param {Object|null} rebufferingStatus
 * @param {Boolean} lowLatencyMode
 * @returns {Number}
 */
function getRebufferingEndGap(
  rebufferingStatus : IRebufferingStatus,
  lowLatencyMode : boolean
) : number {
  if (rebufferingStatus === null) {
    return 0;
  }
  const suffix : "LOW_LATENCY" | "DEFAULT" = lowLatencyMode ? "LOW_LATENCY" :
                                                              "DEFAULT";

  switch (rebufferingStatus.reason) {
    case "seeking":
    case "internal-seek":
      return RESUME_GAP_AFTER_SEEKING[suffix];
    case "not-ready":
      return RESUME_GAP_AFTER_NOT_ENOUGH_DATA[suffix];
    case "buffering":
      return RESUME_GAP_AFTER_BUFFERING[suffix];
  }
}

/**
 * @param {Object} currentRange
 * @param {Number} duration
 * @param {Boolean} lowLatencyMode
 * @returns {Boolean}
 */
function hasLoadedUntilTheEnd(
  currentRange : { start : number; end : number }|null,
  duration : number,
  lowLatencyMode : boolean
) : boolean {
  const suffix : "LOW_LATENCY" | "DEFAULT" = lowLatencyMode ? "LOW_LATENCY" :
                                                              "DEFAULT";
  return currentRange !== null &&
         (duration - currentRange.end) <= REBUFFERING_GAP[suffix];
}

/**
 * Get basic playback information.
 * @param {HTMLMediaElement} mediaElement
 * @param {string} event
 * @returns {Object}
 */
function getMediaInfos(
  mediaElement : HTMLMediaElement,
  event : IPlaybackObserverEventType
) : IMediaInfos {
  const { buffered,
          currentTime,
          duration,
          ended,
          paused,
          playbackRate,
          readyState,
          seeking } = mediaElement;

  const currentRange = getRange(buffered, currentTime);
  return { bufferGap: currentRange !== null ? currentRange.end - currentTime :
                                              // TODO null/0 would probably be
                                              // more appropriate
                                              Infinity,
           buffered,
           currentRange,
           position: currentTime,
           duration,
           ended,
           paused,
           playbackRate,
           readyState,
           seeking,
           event };
}

/**
 * Infer rebuffering status of the media based on:
 *   - the return of the function getMediaInfos
 *   - the previous observation object.
 *
 * @param {Object} prevObservation - Previous playback observation object.
 * @param {Object} currentInfo - Current set of basic information on the
 * `HTMLMediaElement`. This does not need every single property from a regular
 * playback observation.
 * @param {Object} options
 * @returns {Object|null}
 */
function getRebufferingStatus(
  prevObservation : IPlaybackObservation,
  currentInfo : IMediaInfos,
  { withMediaSource, lowLatencyMode } : IPlaybackObserverOptions
) : IRebufferingStatus | null {
  const { event: currentEvt,
          position: currentTime,
          bufferGap,
          currentRange,
          duration,
          paused,
          readyState,
          ended } = currentInfo;

  const { rebuffering: prevRebuffering,
          event: prevEvt,
          position: prevTime } = prevObservation;

  const fullyLoaded = hasLoadedUntilTheEnd(currentRange, duration, lowLatencyMode);

  const canSwitchToRebuffering = (readyState >= 1 &&
                                  currentEvt !== "loadedmetadata" &&
                                  prevRebuffering === null &&
                                  !(fullyLoaded || ended));

  let rebufferEndPosition : number | null = null;
  let shouldRebuffer : boolean | undefined;
  let shouldStopRebuffer : boolean | undefined;

  const rebufferGap = lowLatencyMode ? REBUFFERING_GAP.LOW_LATENCY :
                                       REBUFFERING_GAP.DEFAULT;

  if (withMediaSource) {
    if (canSwitchToRebuffering) {
      if (bufferGap <= rebufferGap) {
        shouldRebuffer = true;
        rebufferEndPosition = currentTime + bufferGap;
      } else if (bufferGap === Infinity) {
        shouldRebuffer = true;
        rebufferEndPosition = currentTime;
      }
    } else if (prevRebuffering !== null) {
      const resumeGap = getRebufferingEndGap(prevRebuffering, lowLatencyMode);
      if (shouldRebuffer !== true && prevRebuffering !== null && readyState > 1 &&
          (fullyLoaded || ended || (bufferGap < Infinity && bufferGap > resumeGap)))
      {
        shouldStopRebuffer = true;
      } else if (bufferGap === Infinity || bufferGap <= resumeGap) {
        rebufferEndPosition = bufferGap === Infinity ? currentTime :
                                                       currentTime + bufferGap;
      }
    }
  }

  // when using a direct file, the media will stall and unstall on its
  // own, so we only try to detect when the media timestamp has not changed
  // between two consecutive timeupdates
  else {
    if (canSwitchToRebuffering &&
        (!paused && currentEvt === "timeupdate" &&
         prevEvt === "timeupdate" && currentTime === prevTime ||
         currentEvt === "seeking" && bufferGap === Infinity)
    ) {
      shouldRebuffer = true;
    } else if (prevRebuffering !== null &&
               (currentEvt !== "seeking" && currentTime !== prevTime ||
                currentEvt === "canplay" ||
                bufferGap < Infinity &&
                (bufferGap > getRebufferingEndGap(prevRebuffering, lowLatencyMode) ||
                 fullyLoaded || ended))
    ) {
      shouldStopRebuffer = true;
    }
  }

  if (shouldStopRebuffer === true) {
    return null;
  } else if (shouldRebuffer === true || prevRebuffering !== null) {
    let reason : "seeking" | "not-ready" | "buffering" | "internal-seek";
    if (currentEvt === "seeking" ||
        prevRebuffering !== null && prevRebuffering.reason === "seeking") {
      reason = "seeking";
    } else if (currentInfo.seeking &&
        ((currentEvt === "internal-seeking") ||
        (prevRebuffering !== null && prevRebuffering.reason === "internal-seek"))) {
      reason = "internal-seek";
    } else if (currentInfo.seeking) {
      reason = "seeking";
    } else if (readyState === 1) {
      reason = "not-ready";
    } else {
      reason = "buffering";
    }
    if (prevRebuffering !== null && prevRebuffering.reason === reason) {
      return { reason: prevRebuffering.reason,
               timestamp: prevRebuffering.timestamp,
               position: rebufferEndPosition };
    }
    return { reason,
             timestamp: performance.now(),
             position: rebufferEndPosition };
  }
  return null;
}

/**
 * Detect if the current media can be considered as "freezing" (i.e. not
 * advancing for unknown reasons).
 *
 * Returns a corresponding `IFreezingStatus` object if that's the case and
 * `null` if not.
 * @param {Object} prevObservation
 * @param {Object} currentInfo
 * @returns {Object|null}
 */
function getFreezingStatus(
  prevObservation : IPlaybackObservation,
  currentInfo : IMediaInfos
) : IFreezingStatus | null {
  if (prevObservation.freezing) {
    if (currentInfo.ended ||
        currentInfo.paused ||
        currentInfo.readyState === 0 ||
        currentInfo.playbackRate === 0 ||
        prevObservation.position !== currentInfo.position)
    {
      return null; // Quit freezing status
    }
    return prevObservation.freezing; // Stay in it
  }

  return currentInfo.event === "timeupdate" &&
         currentInfo.bufferGap > MINIMUM_BUFFER_AMOUNT_BEFORE_FREEZING &&
         !currentInfo.ended &&
         !currentInfo.paused &&
         currentInfo.readyState >= 1 &&
         currentInfo.playbackRate !== 0 &&
         currentInfo.position === prevObservation.position ?
           { timestamp: performance.now() } :
           null;
}

export interface IPlaybackObserverOptions {
  withMediaSource : boolean;
  lowLatencyMode : boolean;
}

/**
 * Pretty print a TimeRanges Object, to see the current content of it in a
 * one-liner string.
 *
 * @example
 * This function is called by giving it directly the TimeRanges, such as:
 * ```js
 * prettyPrintBuffered(document.getElementsByTagName("video")[0].buffered);
 * ```
 *
 * Let's consider this possible return:
 *
 * ```
 * 0.00|==29.95==|29.95 ~30.05~ 60.00|==29.86==|89.86
 *          ^14
 * ```
 * This means that our video element has 29.95 seconds of buffer between 0 and
 * 29.95 seconds.
 * Then 30.05 seconds where no buffer is found.
 * Then 29.86 seconds of buffer between 60.00 and 89.86 seconds.
 *
 * A caret on the second line indicates the current time we're at.
 * The number coming after it is the current time.
 * @param {TimeRanges} buffered
 * @param {number} currentTime
 * @returns {string}
 */
function prettyPrintBuffered(
  buffered : TimeRanges,
  currentTime : number
) : string {
  let str = "";
  let currentTimeStr = "";

  for (let i = 0; i < buffered.length; i++) {
    const start = buffered.start(i);
    const end = buffered.end(i);
    const fixedStart = start.toFixed(2);
    const fixedEnd = end.toFixed(2);
    const fixedDuration = (end - start).toFixed(2);
    const newIntervalStr = `${fixedStart}|==${fixedDuration}==|${fixedEnd}`;
    str += newIntervalStr;
    if (currentTimeStr.length === 0 && end > currentTime) {
      const padBefore = str.length - Math.floor(newIntervalStr.length / 2);
      currentTimeStr = " ".repeat(padBefore) + `^${currentTime}`;
    }
    if (i < buffered.length - 1) {
      const nextStart = buffered.start(i + 1);
      const fixedDiff = (nextStart - end).toFixed(2);
      const holeStr = ` ~${fixedDiff}~ `;
      str += holeStr;
      if (currentTimeStr.length === 0 && currentTime < nextStart) {
        const padBefore = str.length - Math.floor(holeStr.length / 2);
        currentTimeStr = " ".repeat(padBefore) + `^${currentTime}`;
      }
    }
  }
  if (currentTimeStr.length === 0) {
    currentTimeStr = " ".repeat(str.length) + `^${currentTime}`;
  }
  return str + "\n" + currentTimeStr;
}
