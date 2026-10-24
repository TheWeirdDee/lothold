"""Render each page of a PDF to PNG (and a greyscale copy) for visual inspection. Usage: python -I render-pdf.py in.pdf outprefix"""
import sys, fitz
doc = fitz.open(sys.argv[1])
print("pages", doc.page_count)
for i, page in enumerate(doc):
    pix = page.get_pixmap(dpi=110)
    pix.save(f"{sys.argv[2]}-p{i+1}.png")
    fitz.Pixmap(fitz.csGRAY, pix).save(f"{sys.argv[2]}-p{i+1}-gray.png")
    print("page", i + 1, "text chars", len(page.get_text()))
