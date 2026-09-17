// Catalog partial: the search operators surface.
//
// Owner: app/useSearch.ts, lib/searchops.ts, components/TopBar.tsx and
// scripts/e2e/searchops.mjs. Keys added here must be rendered only by that
// surface; a key may live in exactly one partial
// (`scripts/web-i18n-check.mjs` enforces it).
//
// Every string here describes a mapping to an input `search.query` already
// accepts. The honest limits are translated too: an operator the daemon
// cannot express must read as a limit in both locales, never as a silent
// fallback.

export const searchops: Record<string, string> = {
  // The predicate row and the operator autocomplete.
  "Search predicates": "搜索谓词",
  "Predicates": "谓词",
  "Free text": "自由文本",
  "Search operators and values": "搜索运算符与取值",
  "Operators only. Values are suggested where this browser already knows them: tag names come from the loaded tag vocabulary, and protection modes from the daemon's closed protection vocabulary.": "仅运算符。只有在浏览器已掌握取值时才提供取值建议：标签名来自已加载的标签词表，保护模式来自守护进程的封闭保护词表。",
  "Tag, {{count}} items": "标签，{{count}} 个项目",
  "Edit predicate {{token}}": "编辑谓词 {{token}}",
  "Remove predicate {{token}}": "移除谓词 {{token}}",
  "Removes this predicate from the search text.": "从搜索文本中移除该谓词。",
  "Select to edit this predicate in place.": "选择后就地编辑该谓词。",
  "Negated predicate, evaluated over the loaded results. Select to edit.": "取反谓词，仅对已加载的结果求值。选择即可编辑。",
  "The daemon input this predicate writes.": "该谓词实际写入的守护进程输入。",
  "No search was run for this text.": "这段文本没有执行任何搜索。",
  "Operators available: {{operators}}. Select a predicate to edit it, or remove it to rewrite the search text.": "可用运算符：{{operators}}。选择谓词即可编辑，移除谓词会重写搜索文本。",

  // The operator vocabulary, one line each.
  "Durable tag on the subject. Repeat it to require several tags.": "主体的持久标签。重复书写表示同时满足多个标签。",
  "The daemon's entry type (regular_file, directory, symlink, fifo, socket, device, special) or its derived media class (image, video, audio, document, archive, other).": "守护进程的条目类型（regular_file、directory、symlink、fifo、socket、device、special）或其派生的媒体类别（image、video、audio、document、archive、other）。",
  "The entry's recorded filename suffix: its final extension, lowercased by the daemon. A leading dot is accepted.": "条目记录的文件名后缀：最终扩展名，由守护进程转为小写。允许前置点号。",
  "The entry's recorded protection mode: STORE_EXACT, STORE_EXACT_WITH_EXTERNAL_FALLBACK, LINK_ONLY, or METADATA_ONLY.": "条目记录的保护模式：STORE_EXACT、STORE_EXACT_WITH_EXTERNAL_FALLBACK、LINK_ONLY 或 METADATA_ONLY。",
  "The language the daemon recorded for the entry's descriptions, compared as an exact value without case.": "守护进程为该条目描述记录的语言，按精确值比较且不区分大小写。",
  "Logical size in bytes, KB, MB, GB, or TB. Use >10MB, <1GB, 1MB..10MB, or one exact value.": "逻辑大小，单位 B、KB、MB、GB 或 TB。可用 >10MB、<1GB、1MB..10MB 或一个精确值。",
  "Recorded modification time, as an exclusive < or > bound on a YYYY-MM-DD date.": "记录中的修改时间，以 YYYY-MM-DD 日期的排他 < 或 > 边界表示。",
  "Exact-identity duplicates (dup:yes) or unique content (dup:no).": "精确同一性重复内容（dup:yes）或唯一内容（dup:no）。",
  "Recorded source path. Substring is matched as lexical tokens.": "记录中的来源路径。子串按词元匹配。",
  "Displayed file or folder name.": "显示的文件或文件夹名称。",
  "Recorded content id (SHA-256). A complete id filters exactly; a shorter value is a prefix.": "记录中的内容标识（SHA-256）。完整标识为精确过滤，较短取值按前缀匹配。",

  // The honest limit of each mapping, shown on the chip.
  "Entry types are compared exactly. A media class is derived from the entry's recorded filename suffix only — never from its content, name, path, or size — and one entry maps to one class: an entry whose suffix is not recorded matches no media class, including other.": "条目类型按精确值比较。媒体类别只依据条目记录的文件名后缀推导——绝不依据内容、名称、路径或大小——且一个条目只属于一个类别：未记录后缀的条目不匹配任何媒体类别，包括 other。",
  "One value per query. The daemon compares one exact recorded suffix, so a second suffix: predicate is refused instead of becoming an AND that could never hold or an OR the daemon cannot express. An entry whose name records no suffix matches nothing.": "每次查询仅一个取值。守护进程只比较一个精确的记录后缀，因此第二个 suffix: 谓词会被拒绝，而不会变成永远不成立的 AND，或守护进程无法表达的 OR。未记录后缀的条目不匹配任何取值。",
  "One value per query: a second protection: predicate is refused. The daemon compares the mode against the entry's recorded protection text as a whole word or a word prefix, so STORE_EXACT also matches STORE_EXACT_WITH_EXTERNAL_FALLBACK.": "每次查询仅一个取值：第二个 protection: 谓词会被拒绝。守护进程把该模式与条目记录的保护文本按完整词或词前缀比较，因此 STORE_EXACT 也会匹配 STORE_EXACT_WITH_EXTERNAL_FALLBACK。",
  "One value per query: a second lang: predicate is refused. Only an entry with a recorded language can match; an entry with no descriptions, or whose descriptions recorded no language, matches nothing.": "每次查询仅一个取值：第二个 lang: 谓词会被拒绝。只有记录了语言的条目才会匹配；没有描述、或描述未记录语言的条目不匹配任何取值。",
  "Matched as a token prefix in the daemon's tag field, not as an exact tag string.": "按守护进程标签字段中的词元前缀匹配，并非精确标签字符串。",
  "Items without a measured logical size never match a size range.": "没有测得逻辑大小的项目不会匹配任何大小范围。",
  "Exclusive: mtime:<2024-01-01 excludes that exact instant.": "排他边界：mtime:<2024-01-01 不包含该时刻本身。",
  "The daemon records a duplicate projection but no unique-only filter, so dup:no is evaluated over loaded results.": "守护进程只记录重复投影，没有“仅唯一”过滤器，因此 dup:no 只对已加载结果求值。",
  "Token and phrase matching, not an arbitrary substring match.": "按词元与短语匹配，并非任意子串匹配。",
  "A prefix is matched over the hits the daemon returned, and only where a content id was recorded.": "前缀只对守护进程返回的命中结果匹配，且仅在记录了内容标识时成立。",

  // The protection-mode values the autocomplete may offer: a closed
  // vocabulary, one line each.
  "Exact bytes are stored in this repository. This is the default protection mode.": "精确字节存储在本仓库中。这是默认保护模式。",
  "Exact bytes are stored here, with a qualified external route kept as an additional recovery fallback.": "精确字节存储在此处，并保留一条合格的外部路径作为额外恢复后备。",
  "No local copy is kept. The entry stays visibly LINK_ONLY_UNPROTECTED until it is independently reacquired and verified.": "不保留本地副本。该条目在独立重新获取并验证之前会一直明确显示为 LINK_ONLY_UNPROTECTED。",
  "Only catalog metadata is kept. There is no local representation and no recovery claim.": "仅保留编目元数据。没有本地表示，也没有恢复声明。",

  // Tokens the surface refuses instead of turning into a different query.
  "Unknown operator \"{{name}}\". Quote the token to search for it literally.": "未知运算符“{{name}}”。若想按字面搜索，请为该词加引号。",
  "{{operator}}: needs a value.": "{{operator}}: 需要一个取值。",
  "hash:{{value}} is not a hexadecimal content id prefix.": "hash:{{value}} 不是十六进制内容标识前缀。",
  "type:{{value}} is not one of the daemon's entry types (regular_file, directory, symlink, fifo, socket, device, special) or derived media classes (image, video, audio, document, archive, other).": "type:{{value}} 不属于守护进程的条目类型（regular_file、directory、symlink、fifo、socket、device、special）或派生的媒体类别（image、video、audio、document、archive、other）。",
  "-type:{{value}} cannot be expressed: the daemon has no negation for the derived media class, and a search hit carries no recorded suffix, so this browser cannot exclude it.": "-type:{{value}} 无法表达：守护进程没有针对派生媒体类别的取反，且搜索结果不携带记录的后缀，浏览器无法据此排除。",
  "suffix:{{value}} is not a recorded filename suffix. Use the final extension only, without spaces, slashes, colons, or an interior dot (for example png or .png).": "suffix:{{value}} 不是有效的记录文件名后缀。请仅使用最终扩展名，不含空格、斜杠、冒号或内部点号（例如 png 或 .png）。",
  "suffix:{{value}} cannot be expressed: the daemon's suffix filter compares one recorded suffix, so a second suffix: predicate is neither an AND that could hold nor an OR the daemon can express. Keep one suffix: value.": "suffix:{{value}} 无法表达：守护进程的后缀过滤器只比较一个记录后缀，因此第二个 suffix: 谓词既不是可成立的 AND，也不是守护进程能表达的 OR。请只保留一个 suffix: 取值。",
  "protection:{{value}} is not one of the daemon's protection modes (STORE_EXACT, STORE_EXACT_WITH_EXTERNAL_FALLBACK, LINK_ONLY, METADATA_ONLY).": "protection:{{value}} 不属于守护进程的保护模式（STORE_EXACT、STORE_EXACT_WITH_EXTERNAL_FALLBACK、LINK_ONLY、METADATA_ONLY）。",
  "protection:{{value}} cannot be expressed: the daemon's protection filter compares one mode, and a second protection: predicate is not an OR the daemon can express. Keep one protection: value.": "protection:{{value}} 无法表达：守护进程的保护过滤器只比较一个模式，第二个 protection: 谓词不是守护进程能表达的 OR。请只保留一个 protection: 取值。",
  "lang:{{value}} is not a language tag. Use a recorded code such as und or zh-Hans, without spaces, dots, or colons.": "lang:{{value}} 不是有效的语言标签。请使用已记录的代码，例如 und 或 zh-Hans，不含空格、点号或冒号。",
  "lang:{{value}} cannot be expressed: the daemon's language filter compares one recorded language, and a second lang: predicate is not an OR the daemon can express. Keep one lang: value.": "lang:{{value}} 无法表达：守护进程的语言过滤器只比较一个记录语言，第二个 lang: 谓词不是守护进程能表达的 OR。请只保留一个 lang: 取值。",
  "-suffix:{{value}} cannot be expressed: the daemon has no negation for the suffix filter, and a search hit carries no recorded suffix, so this browser cannot exclude it.": "-suffix:{{value}} 无法表达：守护进程的后缀过滤器没有取反，且搜索结果不携带记录的后缀，浏览器无法据此排除。",
  "-protection:{{value}} cannot be expressed: the daemon has no negation for the protection filter, and a search hit carries no recorded protection state, so this browser cannot exclude it.": "-protection:{{value}} 无法表达：守护进程的保护过滤器没有取反，且搜索结果不携带记录的保护状态，浏览器无法据此排除。",
  "-lang:{{value}} cannot be expressed: the daemon has no negation for the language filter, and a search hit carries no recorded language, so this browser cannot exclude it.": "-lang:{{value}} 无法表达：守护进程的语言过滤器没有取反，且搜索结果不携带记录的语言，浏览器无法据此排除。",
  "size:{{value}} is not a size. Use >10MB, <1GB, 1MB..10MB, or one exact value.": "size:{{value}} 不是有效大小。请使用 >10MB、<1GB、1MB..10MB 或一个精确值。",
  "size:{{value}} starts after it ends.": "size:{{value}} 的起始值大于结束值。",
  "mtime:{{value}} is not a date bound. Use <2024-01-01 or >2024-01-01.": "mtime:{{value}} 不是有效日期边界。请使用 <2024-01-01 或 >2024-01-01。",
  "dup:{{value}} is not yes or no.": "dup:{{value}} 不是 yes 或 no。",
  "-mtime: cannot be expressed: a hit carries no modification time, so this browser cannot exclude it.": "-mtime: 无法表达：命中结果不带修改时间，浏览器无法据此排除。",

  // The limits the whole plan carries.
  "Nothing here reaches the daemon: this text has no lexical token and no typed filter, so there are no results for the remaining predicates to narrow. Add a word, tag:, type:, size:, or a complete hash: value.": "这段文本没有任何词元或类型化过滤器会发送给守护进程，因此剩余谓词没有可供筛选的结果。请加入一个词、tag:、type:、size:，或完整的 hash: 取值。",
  "Evaluated over the loaded results only: the daemon has no expression for this predicate, so it is applied to the hits this query returned.": "仅对已加载结果求值：守护进程无法表达该谓词，因此它只作用于本次查询返回的命中结果。",
  "Free text widens every field-scoped predicate: the daemon matches each token against all of its indexed fields in one query.": "自由文本会放宽所有限定字段的谓词：一次查询中守护进程会把每个词元与全部已索引字段匹配。",
  "Evaluated over the loaded results": "仅对已加载结果求值",
  "{{tokens}} cannot be expressed by the daemon's search.query, so this browser applied it to the hits this query returned. Hits without a recorded content id, size, or modification time are not classified.": "{{tokens}} 无法由守护进程的 search.query 表达，因此浏览器把它应用于本次查询返回的命中结果。未记录内容标识、大小或修改时间的命中不会被归类。",
};
