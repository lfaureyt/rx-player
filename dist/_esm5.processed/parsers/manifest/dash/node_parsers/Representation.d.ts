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
import { IBaseURL } from "./BaseURL";
import { IParsedSegmentBase } from "./SegmentBase";
import { IParsedSegmentList } from "./SegmentList";
import { IParsedSegmentTemplate } from "./SegmentTemplate";
import { IScheme } from "./utils";
export interface IRepresentationIntermediateRepresentation {
    children: IRepresentationChildren;
    attributes: IRepresentationAttributes;
}
export interface IRepresentationChildren {
    baseURLs: IBaseURL[];
    inbandEventStreams?: IScheme[];
    segmentBase?: IParsedSegmentBase;
    segmentList?: IParsedSegmentList;
    segmentTemplate?: IParsedSegmentTemplate;
}
export interface IRepresentationAttributes {
    audioSamplingRate?: string;
    bitrate?: number;
    codecs?: string;
    codingDependency?: boolean;
    frameRate?: string;
    height?: number;
    id?: string;
    maxPlayoutRate?: number;
    maximumSAPPeriod?: number;
    mimeType?: string;
    profiles?: string;
    qualityRanking?: number;
    segmentProfiles?: string;
    width?: number;
}
/**
 * @param {Element} representationElement
 * @returns {Array}
 */
export declare function createRepresentationIntermediateRepresentation(representationElement: Element): [IRepresentationIntermediateRepresentation, Error[]];
