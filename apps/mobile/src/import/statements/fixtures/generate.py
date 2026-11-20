"""Genera los extractos de prueba (datos inventados) con reportlab y los cifra con pypdf.

Uso, desde apps/mobile:  python3 src/import/statements/fixtures/generate.py
Los de Davivienda, BBVA y Nu salen de generate.mjs (Chromium); este script cifra el de BBVA.
"""
from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

HERE = Path(__file__).parent
PASSWORD = "1020304050"  # cédula inventada


def us(minor: int) -> str:
    sign = "-" if minor < 0 else ""
    whole, cents = divmod(abs(minor), 100)
    return f"{sign}{whole:,}.{cents:02d}"


def co(minor: int) -> str:
    return us(minor).replace(",", "_").replace(".", ",").replace("_", ".")


def bancolombia() -> None:
    rows = [
        ("1/10", "COMPRA EN EXITO CALLE 80", "BOGOTA", "", -8540000),
        ("2/10", "PAGO PSE CODENSA", "", "4521", -13250000),
        ("3/10", "TRANSFERENCIA DESDE NEQUI", "", "", 20000000),
        ("5/10", "RETIRO CAJERO CENTRO 4", "CENTRO", "0873", -10000000),
        ("5/10", "CUOTA DE MANEJO", "", "", -1450000),
        ("10/10", "ABONO NOMINA EMPRESA SAS", "", "", 320000000),
        ("12/10", "COMPRA EN RAPPI*RESTAURANTE", "", "", -4590000),
        ("15/10", "PAGO TARJETA CREDITO NU", "", "", -60000000),
        ("20/10", "COMPRA EN TIENDA D1 CHAPINERO", "", "", -3875000),
        ("25/10", "TRANSFERENCIA A CTA 4058123456", "", "", -15000000),
        ("30/10", "ABONO INTERESES AHORROS", "", "", 123456),
        ("31/10", "IMPTO GOBIERNO 4X1000", "", "", -448600),
    ]
    opening = 125000000
    c = canvas.Canvas(str(HERE / "bancolombia.pdf"), pagesize=letter)
    c.setTitle("Extracto de prueba")

    def header(page: int) -> float:
        c.setFont("Helvetica-Bold", 12)
        c.drawString(40, 750, "Bancolombia")
        c.setFont("Helvetica", 9)
        c.drawString(40, 735, "ESTADO DE CUENTA - CUENTA DE AHORROS")
        c.drawString(40, 722, "PERSONA DE PRUEBA          NUMERO *****6789")
        c.drawString(40, 709, "DESDE: 2026/10/01   HASTA: 2026/10/31")
        c.drawRightString(560, 750, f"Pagina {page} de 2")
        y = 690
        if page == 1:
            c.drawString(40, y, "SALDO ANTERIOR")
            c.drawRightString(560, y, f"$ {us(opening)}")
            y -= 20
        c.setFont("Helvetica-Bold", 8)
        for x, label in ((40, "FECHA"), (80, "DESCRIPCIÓN"), (280, "SUCURSAL"), (350, "DCTO.")):
            c.drawString(x, y, label)
        c.drawRightString(470, y, "VALOR")
        c.drawRightString(560, y, "SALDO")
        c.setFont("Helvetica", 8)
        return y - 14

    balance = opening
    y = header(1)
    for i, (date, desc, branch, doc, amount) in enumerate(rows):
        if i == 8:
            c.showPage()
            y = header(2)
        balance += amount
        c.drawString(40, y, date)
        c.drawString(80, y, desc)
        c.drawString(280, y, branch)
        c.drawString(350, y, doc)
        c.drawRightString(470, y, us(amount))
        c.drawRightString(560, y, us(balance))
        y -= 13
    c.setFont("Helvetica-Bold", 9)
    c.drawString(40, y - 10, "SALDO ACTUAL")
    c.drawRightString(560, y - 10, f"$ {us(balance)}")
    c.setFont("Helvetica", 7)
    c.drawString(40, 40, "Este extracto es de prueba: todos los datos son inventados.")
    c.save()


def nequi() -> None:
    rows = [
        ("02/10/2026", "Envío a Juana Pérez", -1200000),
        ("03/10/2026", "Recibí de Pedro Gómez", 5000000),
        ("05/10/2026", "Pago en Tiendas Ara", -2345000),
        ("05/10/2026", "Recarga desde Bancolombia", 10000000),
        ("09/10/2026", "Pago de Netflix", -2690000),
        ("18/10/2026", "Retiro en cajero", -5000000),
        ("28/10/2026", "Pago en Restaurante El Corral", -4380000),
    ]
    opening = 15000000
    c = canvas.Canvas(
        str(HERE / "nequi.pdf"),
        pagesize=letter,
        encrypt=__import__("reportlab.lib.pdfencrypt", fromlist=["StandardEncryption"]).StandardEncryption(
            PASSWORD, canPrint=1, strength=128
        ),
    )
    c.setFont("Helvetica-Bold", 14)
    c.drawString(40, 750, "Nequi")
    c.setFont("Helvetica", 9)
    c.drawString(40, 734, "Extracto de tu cuenta de ahorros")
    c.drawString(40, 721, "Periodo: 01/10/2026 al 31/10/2026")
    c.drawString(40, 708, "Saldo anterior")
    c.drawRightString(560, 708, f"$ {co(opening)}")
    c.setFont("Helvetica-Bold", 8)
    c.drawString(40, 685, "Fecha del movimiento")
    c.drawString(150, 685, "Descripción")
    c.drawRightString(460, 685, "Valor")
    c.drawRightString(560, 685, "Saldo")
    c.setFont("Helvetica", 8)
    y = 670
    balance = opening
    for date, desc, amount in rows:
        balance += amount
        c.drawString(40, y, date)
        c.drawString(150, y, desc)
        c.drawRightString(460, y, f"$ {co(amount)}")
        c.drawRightString(560, y, f"$ {co(balance)}")
        y -= 13
    c.drawString(40, y - 10, "Saldo final")
    c.drawRightString(560, y - 10, f"$ {co(balance)}")
    c.save()


def encrypt_bbva() -> None:
    from pypdf import PdfReader, PdfWriter

    source = HERE / "bbva.pdf"
    if not source.exists():
        return
    writer = PdfWriter(clone_from=PdfReader(source))
    writer.encrypt(PASSWORD, algorithm="AES-256")
    with open(source, "wb") as f:
        writer.write(f)


if __name__ == "__main__":
    bancolombia()
    nequi()
    encrypt_bbva()
