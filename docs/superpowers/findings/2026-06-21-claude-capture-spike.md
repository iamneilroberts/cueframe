# Findings — live claude.ai capture spike (2026-06-21)

_Fill this in while running the spike. These results drive Phase 2 selectors/timings._

## Run
- Command: `node dist/spike-claude.js --profile <dir> --out <dir> --prompt "<text>"`
- Date / claude.ai URL:
- Playwright / Chrome channel version:

## Login & session reuse
- First-run login flow worked? (log in once, reused after?):
- Any bot-detection / challenge prompts?:

## Selectors (VERIFIED values — correct DEFAULT_CLAUDE_SELECTORS to match)
- composer:
- sendButton:
- stopButton:
- lastAssistantMessage:
- Did any need a role/name selector instead of CSS?:

## Idle detection
- Did stop-button presence track generation correctly?:
- Did text-length growth track streaming?:
- Chosen stableMs (did 2500 work, or pauses longer?):
- Any false idle before/after streaming?:

## Typing burst
- charsPerFrame used / frame count / looked smooth?:
- Any composer focus/timing issues?:

## Streaming burst
- intervalMs / frame count / stopped reason / maxFrames hit?:
- Total JPEG bytes (size concern for inlined HTML later?):

## Determinism freeze
- Did the native caret / CSS animations show up and look bad?:
- Recommend applying the capture-time freeze (caret/animation:none) in Phase 2?:

## folio MCP widget (if tested)
- Did the cross-origin iframe render in screenshots?:

## Surprises / blockers

## Recommended Phase 2 settings
- selectors:
- stableMs:
- typing charsPerFrame:
- streaming intervalMs:
