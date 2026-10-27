# 0020: Degrees of certainty, and "probably within"

Status: Accepted (October 2026)

## Context
Every status the app gives rests on forecasts and readings that can be wrong. An official forecast can say no rain while it pours; a gauge can lag. Until now the app had three statuses and treated anything it had a specific reason to doubt as unknown. Since #82 and #144, a flow forecast more than 25% off the latest gauge reading is set aside, so on days when the dams are releasing at Montague, every hour after the current one was unknown and the app offered no window at all. The owner found that unhelpful: the forecast still says something, and the rower makes the call (#146).

## Decision
Certainty comes in degrees, and the app says how sure it is rather than saying nothing.

- **Within** means within every limit on forecasts and readings the app has no specific reason to doubt. It is still a forecast, not a promise.
- **Probably within** means within every limit, but at least one value comes from a source the app has a specific, named reason to doubt. Today that is one case: a flow forecast set aside for disagreeing with the gauge. It is offered as a window, always labeled and explained ("the flow forecast doesn't match the gauge"), never shown as plain within.
- **Outside** includes an hour where such a doubtful value is past a limit, with the same explanation.
- **Unknown** stays for hours with no usable value at all: missing data, stale readings, no source.
- **Every answer carries a caveat** that forecasts can be wrong and conditions should be checked on the water. The rower decides.

Hard rule 2 in AGENTS.md becomes: missing data is never treated as acceptable; a value the app doubts is labeled with how sure it is and why.

## Consequences
- A fourth status in evaluation, windows, periods and every place that shows status, with its own label and texture so it isn't told apart by color alone.
- Other reasons for doubt can become further degrees of the same thing later, for example a forecast far ahead or a station far away, each with its own named reason.
- Decision 0001 stands: the app reports conditions against the rower's limits and never says safe or unsafe. "Probably within" is a statement about the data, not a recommendation.
