# Performance implementation ledger

Baseline revision is `6fa67d6`. All timings are local unless explicitly attributed to the supplied captures. See [the findings](perf_findings.md) for baseline performance and outstanding experiments. Each implementation commit carries its own ledger entry.

Before changes, the Chrome SwiftShader shelter fixture produced vegetation luminance sums of 103530 / 0 / 103530 before pitching, while pitched and after packing. Rain sums were 48750 / 0 / 48750 outside, covered and restored. The shadow fixture measured 1447901 with light leakage and 0 with the shadow enabled.
