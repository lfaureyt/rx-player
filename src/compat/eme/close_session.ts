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
import { ICustomMediaKeySession } from "./custom_media_keys";

/** Close session and returns and observable that emits when
 * the session is closed.
 * @param {MediaKeySession|Object} session
 * @returns {Observable}
 */
export default function closeSession$(
  session: MediaKeySession|ICustomMediaKeySession
): Promise<unknown> {
  const closingSessionProm = session.close();

  // If the session is not closed after 1000ms, try
  // to call another method on session to guess if
  // session is closed or not.
  const timeoutProm = new PPromise((resolve) => {
    setTimeout(() => { onTimeout(); }, 1000);
    async function onTimeout() {
      try {
        await session.update(new Uint8Array(1));
      } catch (err) {
        // The caught error can tell if session is closed
        // (Chrome may throw this error)
        if (err instanceof Error &&
            err.message === "The session is already closed."
        ) {
          return resolve(undefined);
        }

        // The `closed` promise may resolve, even if `close()` result has not
        // (it may happen on Firefox). Wait for it and timeout after 1 second.
        const sessionIsClosed$ = session.closed;
        const closeTimeout = new PPromise((_, innerReject) =>
          setTimeout(() => innerReject(new Error("Compat: Couldn't know if session is " +
                                                 "closed")),
                     1000));
        return PPromise.race([sessionIsClosed$, closeTimeout]);
      }

      // If we're here, the update has worked
      throw new Error("Compat: Couldn't know if session is closed");
    }
  });

  // XXX TODO better
  return PPromise.race([closingSessionProm, timeoutProm]);
}
