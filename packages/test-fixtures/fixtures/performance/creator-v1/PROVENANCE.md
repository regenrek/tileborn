# Creator performance fixture v1 provenance

- Source: generated first-party synthetic data definition created for Tileborne.
- Author: Tileborne contributors.
- License: CC0-1.0.
- External assets: none.

The fixture is a deterministic recipe. Consumers derive ids and UTF-8 payloads
from the committed seed, counts, sizes, and lexicographic index ordering. No
third-party art, project data, or benchmark recording is embedded.

`budgets.json` defines environment-independent count, byte, and operation
ceilings/floors only. Native timing baselines and machine/environment receipts
are intentionally not represented as fixture provenance; those are calibrated
and recorded by the follow-up CI/native-evidence item named in the contract.
