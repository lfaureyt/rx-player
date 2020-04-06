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

import nextTick from "next-tick";
import {
  asapScheduler,
  Observable,
} from "rxjs";
import { subscribeOn } from "rxjs/operators";

/**
 * At the first subscription, instead of "running" the Observable right away,
 * wait until the current script has finished executing before actually running
 * this Observable.
 *
 * This can be important for example when you want in a given function to
 * exploit the same shared Observable which may send synchronous events directly
 * after subscription.
 * Calling `deferInitialSubscriptions` in those cases will make sure that all
 * such subscriptions in the same function are registered before the Observable
 * start emitting events (as long as such Subscriptions are done synchronously).
 *
 * @example
 * ```js
 * const myObservable = rxjs.timer(100).pipe(mapTo("ASYNC MSG"),
 *                                           startWith("SYNCHRONOUS MSG"),
 *                                           share());
 *
 * myObservable.subscribe(x => console.log("Sub1:", x));
 * myObservable.subscribe(x => console.log("Sub2:", x));
 *
 * setTimeout(() => {
 *   myObservable.subscribe(x => console.log("Sub3:", x));
 * }, 50);
 *
 * // You will get:
 * // Sub1: SYNCHRONOUS MSG
 * // Sub1: ASYNC MSG
 * // Sub2: ASYNC MSG
 * // Sub3: ASYNC MSG
 *
 * // ------------------------------
 *
 * const myObservableDeferred = rxjs.timer(100).pipe(mapTo("ASYNC MSG"),
 *                                                   startWith("SYNCHRONOUS MSG"),
 *                                                   deferInitialSubscriptions(),
 *                                                   // NOTE: the order is important here
 *                                                   share());
 *
 * myObservableDeferred.subscribe(x => console.log("Sub1:", x));
 * myObservableDeferred.subscribe(x => console.log("Sub2:", x));
 *
 * setTimeout(() => {
 *   myObservableDeferred.subscribe(x => console.log("Sub3:", x));
 * }, 50);
 *
 * // You will get:
 * // Sub1: SYNCHRONOUS MSG
 * // Sub2: SYNCHRONOUS MSG
 * // Sub1: ASYNC MSG
 * // Sub2: ASYNC MSG
 * // Sub3: ASYNC MSG
 * ```
 * @returns {function}
 */
export default function deferInitialSubscriptions<T>(
) : (source: Observable<T>) => Observable<T> {
  let isSubscriptionAsyncWithFirstOne = false;
  return (source: Observable<T>) => {
    if (isSubscriptionAsyncWithFirstOne) {
      return source;
    }
    nextTick(() => { isSubscriptionAsyncWithFirstOne = true; });

    // TODO asapScheduler seems to not push the subscription in the microtask
    // queue as nextTick does but in a regular event loop queue.
    // This means that the subscription will be run even later that we wish for.
    // This is not dramatic but it could be better.
    // Either this is a problem with RxJS or this was wanted, in which case we
    // may need to add our own scheduler.
    return source.pipe(subscribeOn(asapScheduler));
  };
}
