# Third-party notices

## Ark-Unpacker LZ4AK block decoder

The LZ4AK sequence conversion in `extract_operator_art.py` is adapted from
[Ark-Unpacker](https://github.com/isHarryh/Ark-Unpacker), under the following
license:

BSD 3-Clause License

Copyright (c) 2022, Harry Huang
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## Public Arknights data and resource sources

The automated update pipeline reads Chinese game tables from
[Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData).
When files are missing locally, it may also download individual illustrations,
skill icons, and faction logos from
[fexli/ArknightsResource](https://github.com/fexli/ArknightsResource). No source
code from either repository is copied into this project.

The ArknightsResource maintainer states that the game files in that repository
are copyrighted by Hypergryph Network Technology Co., Ltd. and are provided for
educational and research use. Arknights game data and artwork remain the
property of their respective rights holders. This fan project is non-commercial
and should honor removal requests from the source or rights holder.

## 明日方舟一图流 progression statistics

`operator-popularity-signals.json` contains a dated snapshot of public operator
ownership, Elite 2, and skill-mastery percentages from
[明日方舟一图流](https://dev.yituliu.cn/survey/operator-progression-statistics/).
The snapshot is used only as an aggregate gameplay familiarity signal; it does
not contain player-level data. The source page states that its non-game content
is available under the
[Creative Commons Attribution-NonCommercial 4.0 International license](https://creativecommons.org/licenses/by-nc/4.0/).

## Search and video attention signals

`operator-attention-signals.json` may contain dated aggregate search-result and
engagement fields collected from anonymous public result pages. The Bilibili
collector follows the response fields documented by
[bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect/blob/master/docs/search/search_request.md);
the project does not copy that repository's source code. Bing result totals are
treated as estimates. [Baidu Index](https://index.baidu.com/Helper/) has no
anonymous open API in this pipeline and therefore requires a user-authorized
manual export; YouTube likewise remains disabled without an authorized API key.

Search/video data is used only after a provider covers at least 90% of the
operator pool. Incomplete snapshots remain auditable but are disabled for game
scoring, so blocked requests and missing results cannot label operators cold.
