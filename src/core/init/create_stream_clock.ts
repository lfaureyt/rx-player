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
  combineLatest as observableCombineLatest,
  merge as observableMerge,
  Observable,
} from "rxjs";
import {
  ignoreElements,
  map,
  tap,
} from "rxjs/operators";
import Manifest from "../../manifest";
import { IStreamOrchestratorClockTick } from "../stream";
import { IInitClockTick } from "./types";

export interface IStreamClockArguments {
  autoPlay : boolean; // If true, the player will auto-play when initialPlay$ emits
  initialPlay$ : Observable<unknown>; // The initial play has been done
  initialSeek$ : Observable<unknown>; // The initial seek has been done
  manifest : Manifest;
  speed$ : Observable<number>; // The last speed requested by the user
  startTime : number; // The time the player will seek when initialSeek$ emits
}

/**
 * Create clock Observable for the `Stream` part of the code.
 * @param {Observable} initClock$
 * @param {Object} streamClockArgument
 * @returns {Observable}
 */
export default function createStreamClock(
  initClock$ : Observable<IInitClockTick>,
  { autoPlay,
    initialPlay$,
    initialSeek$,
    manifest,
    speed$,
    startTime } : IStreamClockArguments
) : Observable<IStreamOrchestratorClockTick> {
  let initialPlayPerformed = false;
  let initialSeekPerformed = false;

  const updateIsPaused$ = initialPlay$.pipe(
    tap(() => { initialPlayPerformed = true; }),
    ignoreElements());

  const updateTimeOffset$ = initialSeek$.pipe(
    tap(() => { initialSeekPerformed = true; }),
    ignoreElements());

  const clock$ : Observable<IStreamOrchestratorClockTick> =
    observableCombineLatest([initClock$, speed$])
      .pipe(map(([tick, speed]) => {
        const { isLive } = manifest;
        return {
          position: tick.position,
          getCurrentTime: tick.getCurrentTime,
          duration: tick.duration,
          isPaused: initialPlayPerformed ? tick.paused :
                                           !autoPlay,
          liveGap: isLive ? manifest.getMaximumPosition() - tick.position :
                            Infinity,
          readyState: tick.readyState,
          speed,

          // wantedTimeOffset is an offset to add to the timing's current time to have
          // the "real" wanted position.
          // For now, this is seen when the media element has not yet seeked to its
          // initial position, the currentTime will most probably be 0 where the
          // effective starting position will be _startTime_.
          // Thus we initially set a wantedTimeOffset equal to startTime.
          wantedTimeOffset: initialSeekPerformed ? 0 :
                                                   startTime - tick.position,
        };
      }));

  return observableMerge(updateIsPaused$, updateTimeOffset$, clock$);
}
