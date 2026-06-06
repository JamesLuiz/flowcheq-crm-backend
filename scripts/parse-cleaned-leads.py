"""Parse Cleaned_Leads.xlsx and print JSON array to stdout."""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def col_index(col: str) -> int:
    n = 0
    for c in col:
        n = n * 26 + (ord(c) - 64)
    return n


def parse_sheet(path: Path) -> list[list[str]]:
    rows_out: list[list[str]] = []
    with zipfile.ZipFile(path) as z:
        sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
        for row in sheet.findall('.//m:row', NS):
            cells: dict[int, str] = {}
            for c in row.findall('m:c', NS):
                ref = c.get('r', '')
                m = re.match(r'([A-Z]+)', ref)
                col = m.group(1) if m else 'A'
                ci = col_index(col)
                is_elem = c.find('m:is', NS)
                v = c.find('m:v', NS)
                val = ''
                if v is not None and v.text:
                    val = v.text
                elif is_elem is not None:
                    t = is_elem.find('.//m:t', NS)
                    val = t.text if t is not None and t.text else ''
                cells[ci] = val
            if not cells:
                continue
            maxc = max(cells)
            rows_out.append([cells.get(i, '') for i in range(1, maxc + 1)])
    return rows_out


def normalize_phone(raw: str, country: str) -> str | None:
    digits = re.sub(r'\D', '', raw or '')
    if not digits:
        return None
    country = (country or '').upper()
    if country in ('NG', 'NIGERIA'):
        if digits.startswith('234'):
            national = digits[3:]
        elif digits.startswith('0'):
            national = digits[1:]
        else:
            national = digits
        if len(national) < 9:
            return None
        return f'+234{national}'
    if country in ('US', 'USA'):
        if digits.startswith('1') and len(digits) == 11:
            digits = digits[1:]
        if len(digits) != 10:
            return None
        return f'+1{digits}'
    if raw.strip().startswith('+'):
        return f'+{digits}'
    if len(digits) >= 10:
        return f'+{digits}'
    return None


def build_location(city: str, state: str, country: str, address: str) -> str:
    parts = [p.strip() for p in [city, state, country] if p and p.strip()]
    loc = ', '.join(parts)
    if not loc and address:
        loc = address[:120]
    return loc


def main() -> None:
    xlsx = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / 'Cleaned_Leads.xlsx')
    rows = parse_sheet(xlsx)
    if not rows:
        print('[]')
        return
    header = rows[0]
    idx = {name: i for i, name in enumerate(header)}
    leads = []
    for row in rows[1:]:
        def cell(name: str) -> str:
            i = idx.get(name)
            if i is None or i >= len(row):
                return ''
            return str(row[i] or '').strip()

        business = cell('Business Name')
        phone_raw = cell('Phone')
        if not business or not phone_raw:
            continue
        country = cell('Country')
        e164 = normalize_phone(phone_raw, country)
        if not e164:
            continue
        city = cell('City')
        state = cell('State')
        address = cell('Address')
        location = build_location(city, state, country, address)
        website = cell('Website')
        maps_url = cell('Google Maps Url')
        lead = {
            'name': business,
            'businessName': business,
            'phoneNumber': e164,
            'location': location,
            'tags': ['Imported'],
        }
        if website:
            lead['website'] = website
        if maps_url:
            lead['googleMapsUrl'] = maps_url
        leads.append(lead)
    print(json.dumps(leads))


if __name__ == '__main__':
    main()
