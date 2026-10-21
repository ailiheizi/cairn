# Cairn zvec-go source pin

This complete source copy is based on `github.com/zvec-ai/zvec-go` version
`v0.6.1-0.20260721023313-9199195b29da`, source commit
`9199195b29dac4bf369bb16954464ddf2d73e932`, authenticated by the repository's
go.sum entry. Cairn's only source patch changes Go build constraints so the
upstream dynamic-loader implementation also selects with
`cairn_zvec_dynamic`, while excluding the cgo implementation under that tag.
The original `purego` selection remains supported for existing compatibility.
The upstream Apache-2.0 LICENSE is retained.
