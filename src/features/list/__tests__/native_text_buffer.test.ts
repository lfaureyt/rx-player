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

/* eslint-disable @typescript-eslint/no-unsafe-member-access */

// eslint-disable-next-line max-len
import nativeTextTracksBuffer from "../../../core/segment_buffers/implementations/text/native";
import addNativeTextBuffer from "../native_text_buffer";

jest.mock("../../../core/segment_buffers/implementations/text/native", () => ({
  __esModule: true as const,
  default: jest.fn(),
}));

describe("Features list - native Text Buffer", () => {
  it("should add an native Text Buffer in the current features", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const featureObject : any = {};
    addNativeTextBuffer(featureObject);
    expect(featureObject).toEqual({ nativeTextTracksBuffer });
    expect(featureObject.nativeTextTracksBuffer).toBe(nativeTextTracksBuffer);
  });
});
