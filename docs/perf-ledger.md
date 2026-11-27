# Performance implementation ledger

Baseline revision is `6fa67d6`. All timings are local unless explicitly attributed to the supplied captures. See [the findings](perf_findings.md) for baseline performance and outstanding experiments. Each implementation commit carries its own ledger entry.

Before changes, the Chrome SwiftShader shelter fixture produced vegetation luminance sums of 103530 / 0 / 103530 before pitching, while pitched and after packing. Rain sums were 48750 / 0 / 48750 outside, covered and restored. The shadow fixture measured 1447901 with light leakage and 0 with the shadow enabled.

## 1. Spatial shelter queries

Rain and vegetation fetch a 16 m cell's candidate row interval before the exact containment loop. Empty cells require one lookup. Rain also rejects low-alpha fragments before testing cover. The 75 × 75 RG float grid costs 45,000 bytes per world. Out-of-grid queries use the full footprint list.

Chrome SwiftShader reproduced all eight baseline luminance sums exactly, including tent removal and restored rain. Two restart cycles returned geometry and texture counts to the warm baseline. Type check, production build, 198 existing tests and the added rotated-corner/reindex regression passed. Hardware GPU time remains unmeasured.
