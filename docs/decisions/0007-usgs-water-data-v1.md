# 0007: USGS Water Data APIs v1, not legacy WaterServices

Status: Accepted (October 2026)

## Context
USGS is decommissioning the legacy WaterServices APIs (degradation from November 16, 2026, retirement in early 2027). The modernized Water Data APIs reached V1 in September 2026 at `api.waterdata.usgs.gov/ogcapi/v1`.

## Decision
Build the USGS adapter only against Water Data APIs v1.

## Consequences
- Many online examples use the old API or v0 paths; agents must not copy them.
- Sources: https://waterdata.usgs.gov/blog/wdfn-waterservices-degradation/ and https://waterdata.usgs.gov/blog/api-v1-release/
