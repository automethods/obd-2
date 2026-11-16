"""Expose the delivered theory as one browsable book, with no runtime packages.

Only the explicitly listed, locally authored guides are read. The same HTML is
used by the offline reading copy and the interactive book's reference section.
"""
from __future__ import annotations

from html import escape
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

DOCUMENTS = (
    ("VISUAL_WORKBENCH", "Visual workbench: vehicle, wires and diagnostics"),
    ("VEHICLE_MODELS", "Vehicle models and Three.js bindings"),
    ("BEGINNER_HANDBOOK", "Start here: the beginner's handbook"),
    ("SCHEMATIC_WORKSPACE", "Using diagrams and experiments"),
    ("CONNECTOR_REFERENCE", "Connectors and the coolant-sensor circuit"),
    ("LEARNING_GUIDE", "Complete theory: computers, sensors and models"),
    ("WORKED_CASES", "Worked experiments and results"),
    ("PROTOCOL", "Diagnostic messages: optional technical reference"),
    ("FIRMWARE_ROADMAP", "Building toward a virtual vehicle and real firmware"),
    ("EXISTING_BASES", "Existing software that can be reused"),
    ("SOURCES", "Sources and model assumptions"),
    ("ENGDOC_INTEGRATION", "EngDoc and Wordcraft integration notes"),
)


class BookHTML(HTMLParser):
    """Keep document content and headings, removing site navigation and scripts."""
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self, document_id):
        super().__init__(convert_charrefs=True)
        self.document_id = document_id
        self.in_main = False
        self.depth = 0
        self.skip_depth = 0
        self.html = []
        self.headings = []
        self.heading = None
        self.heading_text = []
        self.reserved_ids = set()
        self.used_ids = set()

    def feed(self, data):
        # The local book is supplied as one complete document. Reserve authored
        # IDs before adding fallback IDs so later headings keep their anchors.
        class Identifiers(HTMLParser):
            def handle_starttag(inner, tag, attrs):
                value = dict(attrs).get("id")
                if value:
                    self.reserved_ids.add(self.document_id.lower() + "--" + value)
        collector = Identifiers()
        collector.feed(data)
        super().feed(data)

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        if not self.in_main:
            if tag == "main":
                self.in_main, self.depth = True, 1
            return
        if tag not in self.VOID:
            self.depth += 1
        if self.skip_depth:
            if tag not in self.VOID:
                self.skip_depth += 1
            return
        if tag in {"script", "style", "iframe", "form", "footer", "nav"} or (tag == "header" and attributes.get("id") == "title-block-header"):
            self.skip_depth = 1
            return
        clean = []
        for key, value in attributes.items():
            if value is None or key.startswith("on") or key in {"style", "srcdoc"}:
                continue
            if key in {"href", "src"}:
                if key == "href" and value.startswith("#"):
                    value = "#" + self.document_id.lower() + "--" + value[1:]
                else:
                    if urlsplit(value).scheme not in {"", "http", "https", "mailto"}:
                        continue
                    value = urljoin("/docs/" + self.document_id + ".html", value)
            if key == "id":
                value = self.document_id.lower() + "--" + value
                self.used_ids.add(value)
            clean.append((key, value))
        if tag in {"h1", "h2", "h3", "h4"}:
            heading_id = next((value for key, value in clean if key == "id"), None)
            if not heading_id:
                number = len(self.headings) + 1
                heading_id = self.document_id.lower() + "--heading-" + str(number)
                while heading_id in self.reserved_ids or heading_id in self.used_ids:
                    number += 1
                    heading_id = self.document_id.lower() + "--heading-" + str(number)
                self.used_ids.add(heading_id)
                clean.append(("id", heading_id))
            self.heading = {"id": heading_id, "title": "", "level": int(tag[1])}
            self.heading_text = []
        self.html.append("<" + tag + "".join(" " + key + '="' + escape(value, quote=True) + '"' for key, value in clean) + ">")

    def handle_endtag(self, tag):
        if not self.in_main:
            return
        if self.skip_depth:
            self.skip_depth -= 1
            self.depth -= 1
            return
        if tag == "main" and self.depth == 1:
            self.in_main = False
            self.depth = 0
            return
        if self.heading is not None and tag == "h" + str(self.heading["level"]):
            self.heading["title"] = " ".join("".join(self.heading_text).split())
            self.headings.append(self.heading)
            self.heading = None
        self.html.append("</" + tag + ">")
        if tag not in self.VOID:
            self.depth -= 1

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_data(self, data):
        if self.in_main and not self.skip_depth:
            self.html.append(escape(data))
            if self.heading is not None:
                self.heading_text.append(data)


def read_book(docs: Path) -> dict:
    documents = []
    for file_id, title in DOCUMENTS:
        path = docs / (file_id + ".html")
        if not path.is_file():
            continue
        parser = BookHTML(file_id)
        parser.feed(path.read_text(encoding="utf-8"))
        documents.append({"id": file_id.lower(), "title": title,
                          "html": "".join(parser.html), "headings": parser.headings,
                          "url": "/docs/" + file_id + ".html"})
    return {"documents": documents, "reading_copy": "/OBDII_Learning_Guide.pdf",
            "beginner_copy": "/OBDII_Beginner_Handbook.pdf",
            "note": "The browser book contains live experiments; PDF copies preserve the explanations and diagrams for reading."}
