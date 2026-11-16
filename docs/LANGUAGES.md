# OBD II Lab languages and future AutoMethods integration

Version 0.9.7 supports English (`en`) and Ukrainian (`uk`). The header switch
is available during vehicle setup and in both workspaces. It changes display
text without resetting the vehicle, OBD connection, diagnostic history or inputs.

The initial selection follows an explicit `?lang=en` / `?lang=uk`, then the
manually saved choice, then the first supported browser language, then English.
A manual change updates an existing language query parameter and persists across
reloads. Storage denial does not prevent the app from working.

The preference matches the existing local AutoMethods sources:

- `motion-lab-language` stores `en` or `uk`.
- `motion-lab-language-auto` distinguishes a prior automatic choice from a manual
  choice; a manual switch removes that marker.
- The document gets `lang` and `data-language`.
- `automethodslanguagechange` and cross-tab storage changes synchronize the UI.

`web/i18n-uk.js` contains Ukrainian UI terminology and explicit templates for
live status messages. `web/i18n.js` translates text nodes and accessibility
attributes at the view boundary and restores their original English on demand.
Updates are limited to changed DOM subtrees; the adapter does not own the
simulation clock or API commands. Canvas signal labels use the same translator.
Component/signal search accepts both original and translated names.

Protocol bytes, DTCs, object IDs, connector IDs, editable values, code/preformatted
transcripts and the API/export schema retain their original identities. CSV/JSON
remain machine-readable and are not rebuilt when the language changes.

In-app help is localized. Existing PDF books and linked technical reference
pages remain in English; the help identifies that scope. Advanced technical
model annotations without a catalog entry fall back to their source text.

The package still runs offline with Python's standard-library server and plain
browser JavaScript. No translation service, Vite or npm is required. This change
does not publish or modify the AutoMethods website. A future website integration
must route the application assets and its Python `/api/` endpoints together;
copying the HTML onto static hosting alone does not run the vehicle model.
