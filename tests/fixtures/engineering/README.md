# Engineering test fixtures — NOT commercial records

Everything in this directory is an **isolated engineering input** used only by automated tests and
clearly labelled engineering demonstrations. None of it describes a real supplier, farm, shipment,
quantity, or relationship.

- Supplier IDs, lot references and quantities are invented test values (prefixed `ENG-`).
- Plot geometries are arbitrary coordinate boxes ("probe areas") chosen to exercise dataset coverage
  and validation paths. **A probe area is not a cocoa farm.** Environmental results computed for them
  are real dataset readings for those coordinates, but they say nothing about any real producer.
- `official-sample-submitDds-body.xml` is the official EUDR DDS V3 *test sample* (wood product) from the
  EU documentation, used as a schema-validation positive control. It is not a trade declaration.

These files must never be loaded into the operational database.
