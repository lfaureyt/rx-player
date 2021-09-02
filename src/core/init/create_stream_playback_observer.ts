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
  BehaviorSubject,
  combineLatest as observableCombineLatest,
  merge as observableMerge,
  Observable,
} from "rxjs";
import {
  ignoreElements,
  map,
  share,
  shareReplay,
  skip,
  tap,
} from "rxjs/operators";
import { IPlaybackObservation, PlaybackObserver } from "../api";
import { IStreamOrchestratorPlaybackObservation } from "../stream";
import { IReadOnlyPlaybackObserver } from "./types";

/** Arguments needed to create the Stream's version of the PlaybackObserver. */
export interface IStreamPlaybackObserverArguments {
  /** If true, the player will auto-play when initialPlay$ emits. */
  autoPlay : boolean;
  /** The initial play has been done. */
  initialPlay$ : Observable<unknown>;
  /** The initial seek has been done. */
  initialSeek$ : Observable<unknown>;
  /** The last speed requested by the user. */
  speed$ : BehaviorSubject<number>;
  /** The time the player will seek when initialSeek$ emits. */
  startTime : number;
}

/**
 * Create PlaybackObserver for the `Stream` part of the code.
 * @param {Object} playbackObserver
 * @param {Object} args
 * @returns {Observable}
 */
export default function createStreamPlaybackObserver(
  playbackObserver : PlaybackObserver,
  { autoPlay,
    initialPlay$,
    initialSeek$,
    speed$,
    startTime } : IStreamPlaybackObserverArguments
) : IReadOnlyPlaybackObserver<IStreamOrchestratorPlaybackObservation> {
  let initialPlayPerformed = false;
  let initialSeekPerformed = false;

  const updateIsPaused$ = initialPlay$.pipe(
    tap(() => { initialPlayPerformed = true; }),
    ignoreElements(),
    shareReplay({ refCount: false }));

  const updateTimeOffset$ = initialSeek$.pipe(
    tap(() => { initialSeekPerformed = true; }),
    ignoreElements(),
    shareReplay({ refCount: false }));


  const observation$ : Observable<IStreamOrchestratorPlaybackObservation> =
    observableCombineLatest([playbackObserver.listen(true), speed$]).pipe(
      map(([observation, speed]) => mapInitialObservation(observation, speed)),
      share());

  const listen = observableMerge(updateIsPaused$, updateTimeOffset$, observation$);

  return {
    getLastObservation: () : IStreamOrchestratorPlaybackObservation => {
      const lastObservation = playbackObserver.getLastObservation();
      const speed = speed$.getValue();
      return mapInitialObservation(lastObservation, speed);
    },
    getCurrentTime: () => playbackObserver.getCurrentTime(),
    listen : (includeLastObservation : boolean) =>
      // TODO less wasteful solution?
      includeLastObservation ? listen.pipe(skip(1)) :
                               listen,
  };

  /**
   * Transform the initial format sent by the PlaybackObserver into the target
   * format.
   * @param {Object} initialObservation
   * @param {number} speed
   * @returns {number}
   */
  function mapInitialObservation(
    initialObservation : IPlaybackObservation,
    speed : number
  ) : IStreamOrchestratorPlaybackObservation {
    return {
      position: initialObservation.position,
      duration: initialObservation.duration,
      isPaused: initialPlayPerformed ? initialObservation.paused :
                                       !autoPlay,
      readyState: initialObservation.readyState,
      speed,

      // wantedTimeOffset is an offset to add to the timing's current time to have
      // the "real" wanted position.
      // For now, this is seen when the media element has not yet seeked to its
      // initial position, the currentTime will most probably be 0 where the
      // effective starting position will be _startTime_.
      // Thus we initially set a wantedTimeOffset equal to startTime.
      wantedTimeOffset: initialSeekPerformed ? 0 :
                                               startTime - initialObservation.position,
    };
  }
}
