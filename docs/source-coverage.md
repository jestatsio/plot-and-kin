# Initial source coverage

The first locality is Washington, DC. Coverage is a bounded set of sources and supplied documents. Plot & Kin does not claim a complete title history, every historical resident, or nationwide coverage.

| Source | Initial use | Interpretation and limits |
| --- | --- | --- |
| [DC Historic Data on Buildings / HistoryQuest](https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Historic/MapServer/10) | Structured address lookup with original attributes and geometry | A compiled dataset and a research lead. Attribute values are not original deeds, permits, or proof of identity. Address normalization can miss historic aliases and changed numbering. |
| [DC historical Sanborn map service](https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_HISTORICAL/Sanborn_WebMercator/MapServer) | Fetch a bounded map excerpt with requested and actual extent, spatial reference, attribution, and service identity | The raster comes from the service's fused map cache. Layer 0 is a boundary overlay. Service metadata does not establish blanket redistribution rights or an exact construction date. |
| Researcher-supplied documents | Local document import and passage extraction | Record provenance and permissions. Retain uncertain readings, document/page/image-region locators, and original bytes. |

The [HistoryQuest catalog](https://catalog.data.gov/dataset/historic-data-on-dc-buildings) identifies a CC BY 4.0 license for the compiled dataset. Underlying archival materials can have different rights. The map service credits DC GIS and the Library of Congress. Review the underlying item's rights before distributing map images.

The Library of Congress is an important source of original records and map context. Its appearance in an attribution is not proof that the prototype includes every LoC API or collection. No Ancestry, subscription-newspaper, or other restricted automated integration is assumed.

## Fixtures and evidence boundaries

Real sampled connector responses are in [`tests/fixtures/historyquest-live.json`](../tests/fixtures/historyquest-live.json), including 1920 Rosedale Street NE and 316/318 A Street NE with recorded query provenance. They demonstrate a connector response at the recorded time. They do not establish a full history of the sample property.

The [National Archives manuscript provenance](../tests/fixtures/manuscript-provenance.json) identifies the supplied Declaration of Independence image, its original URL, checksum, and public-domain rights statement. It is unrelated to the sampled DC properties. Automated tests check decoding and crop geometry, not live model transcription accuracy. Passing a document-reading test does not connect its people or events to a property's history.

Synthetic fixtures exercise behavior such as contradictions and approval. Their names, addresses, and conclusions are invented. They are never presented as historical findings.

## Expected gaps

Deed chains, missing permits, undigitized society collections, microfilm, uncertain identity matches, address renumbering, and subscription databases may require further human work. Record these as explicit gaps with suggested next steps. A failed request, unsupported source, or empty API response is not evidence that an event never occurred.
