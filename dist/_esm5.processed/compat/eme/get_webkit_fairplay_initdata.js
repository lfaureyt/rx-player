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
import { itole4, le4toi, } from "../../utils/byte_parsing";
import { leUtf16ToStr, strToLeUtf16, } from "../../utils/string_parsing";
/**
 * Create formatted fairplay initdata for WebKit createSession.
 * Layout is :
 * [initData][4 byte: idLength][idLength byte: id]
 * [4 byte:certLength][certLength byte: cert]
 * @param {Uint8Array} initData
 * @param {Uint8Array} serverCertificate
 * @returns {Uint8Array}
 */
export default function getWebKitFairPlayInitData(initDataBytes, serverCertificateBytes) {
    var initData = initDataBytes instanceof Uint8Array ? initDataBytes :
        new Uint8Array(initDataBytes);
    var serverCertificate = serverCertificateBytes instanceof Uint8Array ?
        serverCertificateBytes :
        new Uint8Array(serverCertificateBytes);
    var length = le4toi(initData, 0);
    if (length + 4 !== initData.length) {
        throw new Error("Unsupported WebKit initData.");
    }
    var initDataUri = leUtf16ToStr(initData);
    var skdIndexInInitData = initDataUri.indexOf("skd://");
    var contentIdStr = skdIndexInInitData > -1 ?
        initDataUri.substring(skdIndexInInitData + 6) :
        initDataUri;
    var id = strToLeUtf16(contentIdStr);
    var offset = 0;
    var res = new Uint8Array(initData.byteLength
        /* id length */ + 4 + id.byteLength
        /* certificate length */ + 4 + serverCertificate.byteLength);
    res.set(initData);
    offset += initData.length;
    res.set(itole4(id.byteLength), offset);
    offset += 4;
    res.set(id, offset);
    offset += id.byteLength;
    res.set(itole4(serverCertificate.byteLength), offset);
    offset += 4;
    res.set(serverCertificate, offset);
    return res;
}
