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
import { ICustomError } from "../../../errors";
import { IRepresentationIndex, ISegment } from "../../../manifest";
export interface IIndexSegment {
    start: number;
    duration: number;
    repeatCount: number;
}
interface ITimelineIndex {
    presentationTimeOffset?: number;
    timescale: number;
    media: string;
    timeline: IIndexSegment[];
    startNumber?: number;
    isLive: boolean;
    timeShiftBufferDepth?: number;
    manifestReceivedTime?: number;
}
export interface ISmoothRIOptions {
    aggressiveMode: boolean;
    isLive: boolean;
    segmentPrivateInfos: ISmoothInitSegmentPrivateInfos;
}
interface ISmoothInitSegmentPrivateInfos {
    bitsPerSample?: number;
    channels?: number;
    codecPrivateData?: string;
    packetSize?: number;
    samplingRate?: number;
    protection?: {
        keyId: Uint8Array;
    };
}
/**
 * RepresentationIndex implementation for Smooth Manifests.
 *
 * Allows to interact with the index to create new Segments.
 *
 * @class SmoothRepresentationIndex
 */
export default class SmoothRepresentationIndex implements IRepresentationIndex {
    private _initSegmentInfos;
    private _isAggressiveMode;
    private _scaledLiveGap?;
    private _initialScaledLastPosition?;
    private _indexValidityTime;
    private _isLive;
    private _index;
    constructor(index: ITimelineIndex, options: ISmoothRIOptions);
    /**
     * Construct init Segment compatible with a Smooth Manifest.
     * @returns {Object}
     */
    getInitSegment(): ISegment;
    /**
     * Generate a list of Segments for a particular period of time.
     *
     * @param {Number} _up
     * @param {Number} _to
     * @returns {Array.<Object>}
     */
    getSegments(_up: number, _to: number): ISegment[];
    /**
     * Returns true if, based on the arguments, the index should be refreshed.
     * (If we should re-fetch the manifest)
     * @param {Number} up
     * @param {Number} to
     * @returns {Boolean}
     */
    shouldRefresh(up: number, to: number): boolean;
    /**
     * Returns first position available in the index.
     *
     * @param {Object} index
     * @returns {Number|null}
     */
    getFirstPosition(): number | null;
    /**
     * Returns last position available in the index.
     * @param {Object} index
     * @returns {Number}
     */
    getLastPosition(): number | undefined;
    /**
     * @param {number} timeSec
     * @returns {number|null}
     */
    checkDiscontinuity(timeSec: number): number | null;
    /**
     * @returns {boolean}
     */
    areSegmentsChronologicallyGenerated(): true;
    isSegmentStillAvailable(segment: ISegment): boolean | undefined;
    /**
     * @param {Error} error
     * @returns {Boolean}
     */
    canBeOutOfSyncError(error: ICustomError): boolean;
    /**
     * Replace this RepresentationIndex by a newly downloaded one.
     * Check if the old index had more information about new segments and re-add
     * them if that's the case.
     * @param {Object} newIndex
     */
    _replace(newIndex: SmoothRepresentationIndex): void;
    _update(newIndex: SmoothRepresentationIndex): void;
    /**
     * @returns {Boolean}
     */
    isFinished(): boolean;
    /**
     * @returns {Boolean}
     */
    isInitialized(): true;
    _addSegments(nextSegments: Array<{
        duration: number;
        time: number;
        timescale: number;
    }>, currentSegment: {
        duration: number;
        time: number;
    }): void;
    /**
     * Clean-up timeline to remove segment information which should not be
     * available due to the timeshift window
     */
    private _refreshTimeline;
}
export {};
