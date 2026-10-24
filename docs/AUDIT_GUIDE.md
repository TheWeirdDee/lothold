# Independent audit guide

This guide lets a reviewer exercise LotHold's uploads, rules, land evidence, allocation ledger and documents **without inventing shipment records**. Every input is a labelled engineering-test file from the kit.

- **Download the files:** from `/test-kit` on any LotHold instance, or from [`web/public/test-kit/`](../web/public/test-kit/) in the repository.
- **Accuracy:** every outcome below is asserted by `tests/integration/test-kit.test.ts` on each `npm test` run.

## Ground rules

- **Labelling:** the files are invented engineering test data. File names contain `ENGINEERING_TEST`, and every supplier, lot and plot identifier starts with `ENG-KIT-`.
- **Plots:** the plot shapes are coordinate probe boxes in Côte d'Ivoire, not farms. Forest readings for them are genuine dataset values for those coordinates only.
- **Keep it separate from real work:**
  - register a dedicated workspace, for example organisation "ENGINEERING TEST — <your name>";
  - start each case reference with `ENG-KIT-`;
  - workspaces are isolated from each other, and nothing from the kit is loaded automatically.
- **Outputs:** the PDFs and XML you generate are engineering drafts. Do not send them anywhere as real records.
- **Running locally:** `npm run dev` (or `npm run build && npm start`) after `npm run setup` and `npm run data:fetch`. For a throwaway database, set `LOTHOLD_INSTANCE=engineering` and a temporary `DATABASE_PATH`.

## Scenario A: complete case, through sign-off

| File | Contents |
|---|---|
| `A1_ENGINEERING_TEST_sources.csv` | One lot, `ENG-KIT-LOT-A`: 1 000 kg declared, 600 kg allocated, plots `ENG-KIT-A-P1;ENG-KIT-A-P2` |
| `A2_ENGINEERING_TEST_plots.geojson` | P1: probe box with recorded 2021–2025 loss. P2: probe box with none. |
| `A3_ENGINEERING_TEST_shipping_document.txt` | Labelled shipping fields, plus an embedded instruction to report 99999 kg and EORI XX123. EORI and country are deliberately absent. |
| `A4_ENGINEERING_TEST_investigation_evidence.txt` | Evidence file for the investigation step |

1. **Create case `ENG-KIT-A`.** On **Shipment details**, upload A3 as a document and press **Propose fields**. Expect:
   - the label "Label parser (deterministic, not AI)", unless a model is configured;
   - activity IMPORT, HS 1801, net mass 600 kg, the description and the operator proposed;
   - EORI and country of activity **not found**;
   - no 99999 or XX123 anywhere;
   - no field applied before **Accept selected fields**.
2. **Accept the proposals**, then enter test values for EORI (`BE0000000000`) and country (`BE`) yourself.
3. **Upload and confirm A1 and A2.** Expect:
   - P1: **land-change signal** (loss recorded 2021–2025; none on land mapped as forest in 2020 by JRC);
   - P2: **no post-2020 loss observed**;
   - overall status: **Needs human review**.
4. **Documents:** create the supplier evidence request PDF.
5. **Findings:** record an investigation for P1.
   - A rationale without evidence is refused.
   - With A4 attached it is recorded.
6. **Allocation:** reserve (600 of 1 000 kg). Expect **Ready for sign-off**.
7. **Sign off**, then create the DDS XML. Expect:
   - "XSD valid", base64 round-trip ok, 2 producers;
   - marked DRAFT — NOT SUBMITTED.
8. **Change any shipment field.** Expect the sign-off and documents to become **out of date**.

## Scenario B: holds and corrections

| File | Deliberate problems |
|---|---|
| `B1_ENGINEERING_TEST_sources_with_errors.csv` | Row 2: `"1,000"` (ambiguous separator). Row 3: 800 kg allocated from a 500 kg lot. Row 4: country `XX`, tonnes units, references plot P5 that does not exist. Row 5: no plot references. |
| `B2_ENGINEERING_TEST_plots_with_errors.geojson` | P1: self-intersecting. P2: longitude/latitude swapped. P3: ring not closed. P4: point without `Area`. |
| `B3_ENGINEERING_TEST_broken.geojson` | Truncated JSON |

1. **Upload B3 on Plots.** It is rejected with "Not valid JSON".
2. **Upload and confirm B1.** Expect holds for:
   - `SRC-ROW:2:quantity_ambiguous_separator`;
   - `SRC-ROW:4:invalid_producer_country`;
   - `SRC-ROW:5:missing_plot_refs`;
   - an over-allocation of `ENG-KIT-LOT-B2` by 300 kg.
3. **Upload and confirm B2.** Expect holds for P1 `self_intersection`, P2 `possible_lat_lon_swap`, P3 `ring_not_closed`, P4 `point_area_missing`, and P5 missing.
   - Overall: blocked by geometry, allocation conflict, **HOLD**.
4. **Preview P2's proposed axis swap.**
   - LotHold creates a corrected copy, and the original file stays active until you confirm the copy.
   - After confirming, P2 is analysed: **no post-2020 loss observed**.
5. **Each finding's "Show source"** opens the exact row, column or plot.

## Scenario C: one source lot shared by two cases

| File | Contents |
|---|---|
| `C1_ENGINEERING_TEST_sources_case1.csv` | `ENG-KIT-LOT-C`: 1 000 kg declared, 700 kg allocated |
| `C2_ENGINEERING_TEST_sources_case2.csv` | The same lot: 400 kg allocated |
| `C3_ENGINEERING_TEST_plots.geojson` | One probe box, used by both cases |

1. **Create `ENG-KIT-C-1`** with C1 + C3, and **`ENG-KIT-C-2`** with C2 + C3.
2. **Reserve in case 1:** `ENG-KIT-LOT-C: 700 kg` is reserved.
3. **Reserve in case 2:** refused (HTTP 409 in the API). Expect:
   - "Source lot ENG-KIT-LOT-C over-allocated by 100 kg";
   - the arithmetic 1 000 − 700 = 300 kg available, 400 kg requested.

## What this does not show

- It does not represent any real exporter's data.
- A clean result on a probe box is not evidence about a farm.
- Live model extraction depends on the server's AI configuration (see `docs/AI.md`). Without one, the labelled label parser is used, as above.
- Testnet anchoring is off unless the operator enables it for your organisation (see `docs/DEPLOYMENT.md`).
