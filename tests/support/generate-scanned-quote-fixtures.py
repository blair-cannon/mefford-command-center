"""Rebuild fictional scan fixtures with the primary Python runtime and Poppler."""
import json
import subprocess
import tempfile
from pathlib import Path
from PIL import Image, ImageEnhance, ImageFilter
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

pdfmetrics.registerFont(TTFont("FixtureSans", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("FixtureSansBold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))

root = Path(__file__).resolve().parents[1] / "fixtures" / "scanned-quotes"
root.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory() as temp:
    scratch = Path(temp)

    def page(name, lines):
        source = scratch / f"{name}.pdf"
        doc = canvas.Canvas(str(source), pagesize=(612, 792))
        doc.setTitle("Fictional subcontractor quote for OCR verification")
        doc.setFont("FixtureSansBold", 17)
        doc.drawString(42, 748, "SYNTHETIC QUOTE - TEST ONLY")
        doc.setFont("FixtureSans", 12)
        y = 716
        for line in lines:
            if y < 60:
                raise ValueError("Fixture page content exceeds the page")
            doc.drawString(42, y, line)
            y -= 25
        doc.save()
        subprocess.run(["pdftoppm", "-png", "-r", "160", "-singlefile", str(source), str(root / name)], check=True)
        return root / f"{name}.png"

    small = page("small-quote", [
        "Test bidder: Example Electrical", "Quote reference: 20260911", "Scope of Work:",
        "Furnish and install branch circuit wiring.", "Provide light fixtures and occupancy sensors.",
        "Test circuits and label the electrical panel.", "Exclusions:", "Utility company service fees.",
        "Schedule: Two weeks after notice to proceed.", "Grand Total: $850.25", "Total Days: 14",
    ])
    split = page("split-total", [
        "Test bidder: Example Mechanical", "Quote reference: 20260912", "Scope of Work:",
        "Furnish and install rooftop HVAC equipment.", "Provide sheet metal ductwork and controls.",
        "Perform balancing, startup and commissioning.", "Exclusions:", "Electrical service and utility fees.",
        "Allowance: $25,000.00", "Subtotal: $180,000.00", "Tax: $7,450.00", "Grand Total:", "$187,450.00", "Schedule: Six weeks after approval.",
    ])
    with Image.open(split) as original:
        scan = ImageEnhance.Contrast(original.convert("RGB")).enhance(0.78)
        scan = scan.rotate(1.3, resample=Image.Resampling.BICUBIC, expand=True, fillcolor="white")
        scan = scan.filter(ImageFilter.GaussianBlur(0.35))
        scan.save(root / "tilted-quote.jpg", quality=76)
    split.unlink()
    first = page("scope-page-1", [
        "Test bidder: Example Plumbing", "Page 1 of 2", "Scope of Work:",
        "Install domestic water distribution piping.", "Provide sanitary waste and vent piping.",
        "Exclusions:", "Municipal tap and impact fees.",
    ])
    second = page("scope-page-2", [
        "Test bidder: Example Plumbing", "Page 2 of 2", "Scope of Work (continued):",
        "Furnish and install plumbing fixtures.", "Pressure test and disinfect water piping.",
        "Exclusions:", "Landscape restoration outside the building.", "Grand Total: $37,500.00",
        "Schedule: Four weeks after rough-in approval.",
    ])
    image_pdf = canvas.Canvas(str(root / "image-only-quote.pdf"), pagesize=(612, 792))
    for picture in (first, second):
        image_pdf.drawImage(str(picture), 0, 0, width=612, height=792)
        image_pdf.showPage()
    image_pdf.save()
    hybrid = canvas.Canvas(str(root / "hybrid-quote.pdf"), pagesize=(612, 792))
    hybrid.setFont("FixtureSans", 10)
    hybrid.drawString(30, 775, "Received document - estimating department - September 11 2026")
    hybrid.drawImage(str(small), 0, 0, width=594, height=768)
    hybrid.save()

cases = [
    {"file": "small-quote.png", "price": 850.25, "scope": ["branch circuit wiring", "occupancy sensors", "electrical panel"], "exclusions": ["Utility company service fees"]},
    {"file": "tilted-quote.jpg", "price": 187450, "scope": ["rooftop HVAC equipment", "ductwork and controls", "startup and commissioning"], "exclusions": ["Electrical service and utility fees"]},
    {"file": "image-only-quote.pdf", "price": 37500, "scope": ["domestic water distribution", "sanitary waste", "plumbing fixtures", "disinfect water piping"], "exclusions": ["Municipal tap", "Landscape restoration"]},
    {"file": "hybrid-quote.pdf", "price": 850.25, "scope": ["branch circuit wiring", "occupancy sensors", "electrical panel"], "exclusions": ["Utility company service fees"]},
]
(root / "expected.json").write_text(json.dumps(cases, indent=2) + "\n")
print(f"Created {len(cases)} fictional scan cases in {root}")
