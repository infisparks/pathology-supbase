import { jsPDF } from "jspdf"
import letterhead from "@/public/letterhead.png"
import firstpage from "@/public/first.png"
import stamp from "@/public/stamp.png"
import stamp2 from "@/public/stamp2.png"
import type {
  Parameter,
  BloodTestData,
  PatientData,
  CombinedTestGroup,
  TableCell,
  TableRow,
  ParsedTable,
  CSSStyles,
  HistoricalTestEntry,
  ComparisonTestSelection,
} from "./types/report"

// -----------------------------
// Helper Functions
// -----------------------------
const loadImageAsCompressedJPEG = async (url: string, quality = 0.5) => {
  const res = await fetch(url)
  const blob = await res.blob()
  return new Promise<string>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement("canvas")
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext("2d")
      if (!ctx) return reject(new Error("canvas"))
      ctx.drawImage(img, 0, 0)
      resolve(c.toDataURL("image/jpeg", quality))
    }
    img.onerror = reject
    img.src = URL.createObjectURL(blob)
  })
}

const parseRangeKey = (key: string) => {
  key = key.trim()
  const suf = key.slice(-1)
  let mul = 1
  if (suf === "m") mul = 30
  else if (suf === "y") mul = 365
  const core = key.replace(/[dmy]$/, "")
  const [lo, hi] = core.split("-")
  return { lower: Number(lo) * mul || 0, upper: Number(hi) * mul || Number.POSITIVE_INFINITY }
}

const parseNumericRangeString = (str: string) => {
  const up = /^\s*up\s*(?:to\s*)?([\d.]+)\s*$/i.exec(str)
  if (up) {
    const upper = Number.parseFloat(up[1])
    return isNaN(upper) ? null : { lower: 0, upper }
  }
  const m = /^\s*([\d.]+)\s*(?:-|to)\s*([\d.]+)\s*$/i.exec(str)
  if (!m) return null
  const lower = Number.parseFloat(m[1]),
    upper = Number.parseFloat(m[2])
  return isNaN(lower) || isNaN(upper) ? null : { lower, upper }
}

const formatDMY = (date: Date | string) => {
  const d = typeof date === "string" ? new Date(date) : date
  const day = d.getDate().toString().padStart(2, "0")
  const month = (d.getMonth() + 1).toString().padStart(2, "0")
  const year = d.getFullYear()
  let hours = d.getHours()
  const mins = d.getMinutes().toString().padStart(2, "0")
  const ampm = hours >= 12 ? "PM" : "AM"
  hours = hours % 12 || 12
  const hrsStr = hours.toString().padStart(2, "0")
  return `${day}/${month}/${year}, ${hrsStr}:${mins} ${ampm}`
}

const decodeHTMLEntities = (text: string): string => {
  const entities: Record<string, string> = {
    "&lt;": "<",
    "&gt;": ">",
    "&amp;": "&",
    "&quot;": '"',
    "&apos;": "'",
    "&nbsp;": " ",
    "&ge;": "≥",
    "&le;": "≤",
    "&ne;": "≠",
    "&plusmn;": "±",
    "&times;": "×",
    "&divide;": "÷",
    "&deg;": "°",
    "&micro;": "µ",
    "&alpha;": "α",
    "&beta;": "β",
    "&gamma;": "γ",
    "&delta;": "δ",
    "&omega;": "ω",
  }

  return text.replace(/&[a-zA-Z0-9#]+;/g, (entity) => {
    return entities[entity] || entity
  })
}

const parseColor = (color: string): [number, number, number] | null => {
  if (!color) return null

  if (color.startsWith("#")) {
    const hex = color.slice(1)
    if (hex.length === 3) {
      return [
        Number.parseInt(hex[0] + hex[0], 16),
        Number.parseInt(hex[1] + hex[1], 16),
        Number.parseInt(hex[2] + hex[2], 16),
      ]
    } else if (hex.length === 6) {
      return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
      ]
    }
  }

  const rgbMatch = color.match(/rgb\s*$$\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$$/)
  if (rgbMatch) {
    return [Number.parseInt(rgbMatch[1]), Number.parseInt(rgbMatch[2]), Number.parseInt(rgbMatch[3])]
  }

  const namedColors: Record<string, [number, number, number]> = {
    red: [255, 0, 0],
    green: [0, 128, 0],
    blue: [0, 0, 255],
    black: [0, 0, 0],
    white: [255, 255, 255],
    gray: [128, 128, 128],
    grey: [128, 128, 128],
    yellow: [255, 255, 0],
    orange: [255, 165, 0],
    purple: [128, 0, 128],
    pink: [255, 192, 203],
    brown: [165, 42, 42],
    navy: [0, 0, 128],
    teal: [0, 128, 128],
    lime: [0, 255, 0],
    cyan: [0, 255, 255],
    magenta: [255, 0, 255],
    silver: [192, 192, 192],
    maroon: [128, 0, 0],
    olive: [128, 128, 0],
  }

  const lowerColor = color.toLowerCase()
  return namedColors[lowerColor] || null
}

const parseCSSUnit = (value: string, baseFontSize = 9): number => {
  if (!value) return 0

  const numMatch = value.match(/^([\d.]+)(px|pt|em|rem|%)?$/i)
  if (!numMatch) return 0

  const num = Number.parseFloat(numMatch[1])
  const unit = numMatch[2]?.toLowerCase() || "px"

  switch (unit) {
    case "pt":
      return num
    case "px":
      return num * 0.75
    case "em":
    case "rem":
      return num * baseFontSize
    case "%":
      return (num / 100) * baseFontSize
    default:
      return num
  }
}

const parseInlineCSS = (styleAttr: string): CSSStyles => {
  const styles: CSSStyles = {}

  if (!styleAttr) return styles

  const declarations = styleAttr.split(";").filter(Boolean)

  declarations.forEach((declaration) => {
    const [property, value] = declaration.split(":").map((s) => s.trim())
    if (!property || !value) return

    const prop = property.toLowerCase()

    switch (prop) {
      case "color":
        styles.color = value
        break
      case "background-color":
      case "background":
        styles.backgroundColor = value
        break
      case "font-weight":
        styles.fontWeight = value
        break
      case "font-style":
        styles.fontStyle = value
        break
      case "font-size":
        styles.fontSize = parseCSSUnit(value)
        break
      case "text-align":
        styles.textAlign = value
        break
      case "margin":
        styles.margin = parseCSSUnit(value)
        break
      case "padding":
        styles.padding = parseCSSUnit(value)
        break
      case "border-width":
        styles.borderWidth = parseCSSUnit(value)
        break
      case "border-color":
        styles.borderColor = value
        break
      case "border":
        const borderParts = value.split(/\s+/)
        borderParts.forEach((part) => {
          if (part.match(/^\d/)) {
            styles.borderWidth = parseCSSUnit(part)
          } else if (part.match(/^(solid|dashed|dotted)$/)) {
            styles.borderStyle = part
          } else {
            styles.borderColor = part
          }
        })
        break
      case "width":
        styles.width = parseCSSUnit(value)
        break
      case "height":
        styles.height = parseCSSUnit(value)
        break
    }
  })

  return styles
}

const applyCSSStyles = (doc: jsPDF, styles: CSSStyles, defaultFontSize = 9) => {
  if (styles.fontSize) {
    doc.setFontSize(styles.fontSize)
  }

  let fontStyle = "normal"
  if (
    styles.fontWeight === "bold" ||
    styles.fontWeight === "bolder" ||
    Number.parseInt(styles.fontWeight || "400") >= 600
  ) {
    fontStyle = "bold"
  }
  if (styles.fontStyle === "italic") {
    fontStyle = fontStyle === "bold" ? "bolditalic" : "italic"
  }
  doc.setFont("helvetica", fontStyle)

  if (styles.color) {
    const color = parseColor(styles.color)
    if (color) {
      doc.setTextColor(color[0], color[1], color[2])
    }
  }
}

const parseTable = (tableElement: Element): ParsedTable => {
  const rows: TableRow[] = []
  let hasHeader = false

  const tableStyles = parseInlineCSS(tableElement.getAttribute("style") || "")

  const thead = tableElement.querySelector("thead")
  const tbody = tableElement.querySelector("tbody")

  if (thead) {
    hasHeader = true
    const headerRows = thead.querySelectorAll("tr")
    headerRows.forEach((row) => {
      const rowStyles = parseInlineCSS(row.getAttribute("style") || "")
      const cells: TableCell[] = []
      const cellElements = row.querySelectorAll("th, td")
      cellElements.forEach((cell) => {
        const cellStyles = parseInlineCSS(cell.getAttribute("style") || "")
        cells.push({
          content: decodeHTMLEntities(cell.innerHTML.replace(/<br\s*\/?>/gi, "\n")),
          isHeader: true,
          colspan: Number.parseInt(cell.getAttribute("colspan") || "1"),
          rowspan: Number.parseInt(cell.getAttribute("rowspan") || "1"),
          styles: cellStyles,
        })
      })
      rows.push({ cells, styles: rowStyles })
    })
  }

  const bodyRows = tbody ? tbody.querySelectorAll("tr") : tableElement.querySelectorAll("tr")
  bodyRows.forEach((row) => {
    if (thead && thead.contains(row)) return

    const rowStyles = parseInlineCSS(row.getAttribute("style") || "")
    const cells: TableCell[] = []
    const cellElements = row.querySelectorAll("th, td")
    cellElements.forEach((cell) => {
      const cellStyles = parseInlineCSS(cell.getAttribute("style") || "")
      cells.push({
        content: decodeHTMLEntities(cell.innerHTML.replace(/<br\s*\/?>/gi, "\n")),
        isHeader: cell.tagName.toLowerCase() === "th",
        colspan: Number.parseInt(cell.getAttribute("colspan") || "1"),
        rowspan: Number.parseInt(cell.getAttribute("rowspan") || "1"),
        styles: cellStyles,
      })
    })
    rows.push({ cells, styles: rowStyles })
  })

  return { rows, hasHeader, styles: tableStyles }
}

const renderTable = (doc: jsPDF, table: ParsedTable, x: number, y: number, maxWidth: number): number => {
  if (table.rows.length === 0) return y

  const lineHeight = 5
  const defaultCellPadding = 2
  const defaultBorderWidth = 0.5

  const maxCols = Math.max(...table.rows.map((row) => row.cells.length))
  const colWidth = maxWidth / maxCols

  let currentY = y

  table.rows.forEach((row, rowIndex) => {
    let maxRowHeight = 0
    const cellHeights: number[] = []

    row.cells.forEach((cell, cellIndex) => {
      const cellPadding = cell.styles?.padding || defaultCellPadding
      const cellWidth = colWidth * (cell.colspan || 1) - 2 * cellPadding

      if (cell.styles) {
        applyCSSStyles(doc, cell.styles)
      } else if (cell.isHeader) {
        doc.setFont("helvetica", "bold").setFontSize(9)
      } else {
        doc.setFont("helvetica", "normal").setFontSize(8)
      }

      const lines = doc.splitTextToSize(cell.content.replace(/<[^>]*>/g, ""), cellWidth)
      const cellHeight = Math.max(lines.length * lineHeight + 2 * cellPadding, lineHeight + 2 * cellPadding)
      cellHeights.push(cellHeight)
      maxRowHeight = Math.max(maxRowHeight, cellHeight)
    })

    let currentX = x
    row.cells.forEach((cell, cellIndex) => {
      const cellWidth = colWidth * (cell.colspan || 1)
      const cellHeight = maxRowHeight
      const cellPadding = cell.styles?.padding || defaultCellPadding
      const borderWidth = cell.styles?.borderWidth || defaultBorderWidth

      doc.setLineWidth(borderWidth)
      if (cell.styles?.borderColor) {
        const borderColor = parseColor(cell.styles.borderColor)
        if (borderColor) {
          doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2])
        }
      } else {
        doc.setDrawColor(0, 0, 0)
      }

      let hasFill = false
      if (cell.styles?.backgroundColor) {
        const bgColor = parseColor(cell.styles.backgroundColor)
        if (bgColor) {
          doc.setFillColor(bgColor[0], bgColor[1], bgColor[2])
          hasFill = true
        }
      } else if (cell.isHeader) {
        doc.setFillColor(240, 240, 240)
        hasFill = true
      }

      if (hasFill) {
        doc.rect(currentX, currentY, cellWidth, cellHeight, "FD")
      } else {
        doc.rect(currentX, currentY, cellWidth, cellHeight, "D")
      }

      if (cell.styles) {
        applyCSSStyles(doc, cell.styles)
      } else if (cell.isHeader) {
        doc.setFont("helvetica", "bold").setFontSize(9)
        doc.setTextColor(0, 0, 0)
      } else {
        doc.setFont("helvetica", "normal").setFontSize(8)
        doc.setTextColor(0, 0, 0)
      }

      const textWidth = cellWidth - 2 * cellPadding
      const lines = doc.splitTextToSize(cell.content.replace(/<[^>]*>/g, ""), textWidth)

      const textAlign = cell.styles?.textAlign || "left"
      lines.forEach((line: string, lineIndex: number) => {
        let textX = currentX + cellPadding
        if (textAlign === "center") {
          textX = currentX + cellWidth / 2
        } else if (textAlign === "right") {
          textX = currentX + cellWidth - cellPadding
        }

        doc.text(line, textX, currentY + cellPadding + (lineIndex + 1) * lineHeight, {
          align: textAlign as any,
        })
      })

      currentX += cellWidth
    })

    currentY += maxRowHeight
  })

  return currentY + 5
}

const parseHTMLContent = (doc: jsPDF, htmlContent: string, x: number, y: number, maxWidth: number): number => {
  const parser = new DOMParser()
  const htmlDoc = parser.parseFromString(`<div>${htmlContent}</div>`, "text/html")
  const container = htmlDoc.querySelector("div")

  let currentY = y
  const lineHeight = 5

  if (!container) {
    const cleanText = decodeHTMLEntities(htmlContent.replace(/<[^>]*>/g, ""))
    const lines = doc.splitTextToSize(cleanText, maxWidth)
    doc.setFont("helvetica", "normal").setFontSize(9)
    doc.text(lines, x, currentY)
    return currentY + lines.length * lineHeight
  }

  const processNode = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = decodeHTMLEntities(node.textContent?.trim() || "")
      if (text) {
        const lines = doc.splitTextToSize(text, maxWidth)
        doc.text(lines, x, currentY)
        currentY += lines.length * lineHeight
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element
      const tagName = element.tagName.toLowerCase()

      const styles = parseInlineCSS(element.getAttribute("style") || "")

      if (tagName === "table") {
        currentY = renderTable(doc, parseTable(element), x, currentY, maxWidth)
        return
      }

      if (Object.keys(styles).length > 0) {
        applyCSSStyles(doc, styles)
      } else {
        switch (tagName) {
          case "h1":
            doc.setFont("helvetica", "bold").setFontSize(14)
            currentY += 2
            break
          case "h2":
            doc.setFont("helvetica", "bold").setFontSize(12)
            currentY += 2
            break
          case "h3":
            doc.setFont("helvetica", "bold").setFontSize(11)
            currentY += 1
            break
          case "h4":
          case "h5":
          case "h6":
            doc.setFont("helvetica", "bold").setFontSize(10)
            currentY += 1
            break
          case "strong":
          case "b":
            doc.setFont("helvetica", "bold").setFontSize(9)
            break
          case "em":
          case "i":
            doc.setFont("helvetica", "italic").setFontSize(9)
            break
          case "u":
            doc.setFont("helvetica", "normal").setFontSize(9)
            break
          case "p":
            doc.setFont("helvetica", "normal").setFontSize(9)
            if (currentY > y) currentY += 2
            break
          case "br":
            currentY += lineHeight
            return
          case "li":
            doc.setFont("helvetica", "normal").setFontSize(9)
            doc.text("• ", x, currentY)
            const bulletWidth = doc.getTextWidth("• ")
            const listText = decodeHTMLEntities(element.textContent?.trim() || "")
            const listLines = doc.splitTextToSize(listText, maxWidth - bulletWidth)
            doc.text(listLines, x + bulletWidth, currentY)
            currentY += listLines.length * lineHeight
            return
          case "ul":
          case "ol":
            currentY += 1
            break
          case "thead":
          case "tbody":
          case "tr":
          case "th":
          case "td":
            return
          default:
            doc.setFont("helvetica", "normal").setFontSize(9)
        }
      }

      if (tagName === "div" || tagName === "span") {
        if (styles.backgroundColor) {
          const bgColor = parseColor(styles.backgroundColor)
          if (bgColor) {
            doc.setFillColor(bgColor[0], bgColor[1], bgColor[2])
            const textHeight = lineHeight * 1.2
            doc.rect(x, currentY - textHeight + 2, maxWidth, textHeight, "F")
          }
        }
      }

      for (let i = 0; i < node.childNodes.length; i++) {
        processNode(node.childNodes[i])
      }

      if (["h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "div"].includes(tagName)) {
        currentY += styles.margin || 1
      }

      doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(0, 0, 0)
    }
  }

  for (let i = 0; i < container.childNodes.length; i++) {
    processNode(container.childNodes[i])
  }

  return currentY
}

const slugifyTestName = (name: string) =>
  name
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[.#$[\]()]/g, "")

// -----------------------------
// Main PDF Generation Function
// -----------------------------
export const generateReportPdf = async (
  data: PatientData,
  selectedTests: string[],
  combinedGroups: CombinedTestGroup[],
  historicalTestsData: Record<string, HistoricalTestEntry[]>,
  comparisonSelections: Record<string, ComparisonTestSelection>,
  reportType: "normal" | "comparison" | "combined",
  includeLetterhead: boolean,
  skipCover: boolean,
) => {
  const doc = new jsPDF("p", "mm", "a4")
  // pick one of the selected tests (e.g. the first one) to grab its enteredBy
const firstTestKey = Object.keys(data.bloodtest || {})[0]  
const printedBy =
  data.bloodtest?.[firstTestKey]?.enteredBy  
  ?? "Lab System"

  const w = doc.internal.pageSize.getWidth()
  const h = doc.internal.pageSize.getHeight()
  const left = 23
  const totalW = w - 2 * left
  const base = totalW / 4
  const wParam = base * 1.4
  const wValue = base * 0.6
  const wRange = base * 1.2
  const wUnit = totalW - (wParam + wValue + wRange)
  const x1 = left
  const x2 = x1 + wParam
  const x3 = x2 + wValue + 15
  const x4 = x3 + wUnit
  const lineH = 5
  const ageDays = data.total_day ? Number(data.total_day) : Number(data.age) * 365
  const genderKey = data.gender?.toLowerCase() ?? ""
  const footerMargin = 5 // User specified 48mm

  // Constants for stamp positioning
  const STAMP_WIDTH = 40
  const STAMP_HEIGHT = 30
  const STAMP_BOTTOM_MARGIN = 23 // Distance from bottom of page

  // New helper for adding stamps and printed by text
  const addStampsAndPrintedBy = async (
    doc: jsPDF,
    w: number,
    h: number,
    left: number,
    enteredBy: string
  ) => {
    const sy = h - STAMP_HEIGHT - STAMP_BOTTOM_MARGIN

    // Stamp 2 (right)
    const sx2 = w - left - STAMP_WIDTH
    try {
      const img2 = await loadImageAsCompressedJPEG(stamp2.src, 0.5)
      doc.addImage(img2, "JPEG", sx2, sy, STAMP_WIDTH, STAMP_HEIGHT)
    } catch (e) {
      console.error("Stamp 2 load error:", e)
    }

    // Stamp 1 (center)
    const sx1 = (w - STAMP_WIDTH) / 2
    try {
      const img1 = await loadImageAsCompressedJPEG(stamp.src, 0.5)
      doc.addImage(img1, "JPEG", sx1, sy, STAMP_WIDTH, STAMP_HEIGHT)
    } catch (e) {
      console.error("Stamp 1 load error:", e)
    }

    doc.setFont("helvetica", "normal").setFontSize(10)
    doc.text(`Printed by ${enteredBy}`, left, sy + STAMP_HEIGHT) // Position below the stamps
  }

  const addCover = async () => {
    if (skipCover) return
    try {
      const img = await loadImageAsCompressedJPEG(firstpage.src, 0.5)
      doc.addImage(img, "JPEG", 0, 0, w, h)
    } catch (e) {
      console.error("Error loading cover image:", e)
    }
  }

  const headerY = (reportedOnRaw?: string) => {
    const gap = 7
    let y = 50
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(0, 0, 0)

    const sampleDT = data.sampleCollectedAt ? new Date(data.sampleCollectedAt) : new Date(data.createdAt)
    const sampleDTStr = formatDMY(sampleDT)
    const registrationStr = formatDMY(data.createdAt)
    const reportedOnStr = reportedOnRaw ? formatDMY(reportedOnRaw) : "-"

    const leftRows = [
      {
        label: "Patient Name",
        value: data.title ? `${data.title} ${data.name.toUpperCase()}` : data.name.toUpperCase(),
      },
      {
        label: "Age/Sex",
        value: `${data.age} ${data.total_day ? "Days" : "Years"} / ${data.gender}`,
      },
      {
        label: "Ref Doctor",
        value: (data.doctorName || "-").toUpperCase(),
      },
      { label: "Client Name", value: (data.hospitalName || "-").toUpperCase() },
    ]
    const mergedPatientId = data.patientId && data.registration_id
    ? `${data.patientId}-${data.registration_id}`
    : data.patientId || data.registration_id || "-";
  
    const rightRows = [
      { label: "Patient ID", value: mergedPatientId },
            { label: "Sample Collected on", value: sampleDTStr },
      { label: "Registration On", value: registrationStr },
      { label: "Reported On", value: reportedOnStr },
    ]

    const maxLeftLabel = Math.max(...leftRows.map((r) => doc.getTextWidth(r.label)))
    const maxRightLabel = Math.max(...rightRows.map((r) => doc.getTextWidth(r.label)))

    const xLL = left
    const xLC = xLL + maxLeftLabel + 2
    const xLV = xLC + 2
    const startR = w / 2 + 10
    const xRL = startR
    const xRC = xRL + maxRightLabel + 2
    const xRV = xRC + 2
    const leftValueWidth = startR - xLV - 4

    for (let i = 0; i < leftRows.length; i++) {
      doc.text(leftRows[i].label, xLL, y)
      doc.text(":", xLC, y)
      if (i === 0) {
        doc.setFont("helvetica", "bold")
        const nameLines = doc.splitTextToSize(leftRows[i].value, leftValueWidth)
        doc.text(nameLines, xLV, y)
        doc.setFont("helvetica", "normal")
        y += nameLines.length * (gap - 2)
      } else {
        doc.text(leftRows[i].value, xLV, y)
        y += gap - 2
      }
      doc.text(rightRows[i].label, xRL, y - (gap - 2))
      doc.text(":", xRC, y - (gap - 2))
      doc.text(rightRows[i].value.toString(), xRV, y - (gap - 2))
    }
    return y
  }

  // Helper to add new page with letterhead, header, and stamps
  const addNewPageWithHeader = async (reportedOnRaw?: string) => {
    doc.addPage()
    if (includeLetterhead) {
      await loadImageAsCompressedJPEG(letterhead.src, 0.5).then((img) => doc.addImage(img, "JPEG", 0, 0, w, h))
    }
    const y = headerY(reportedOnRaw) // Get Y position after header
    await addStampsAndPrintedBy(doc, w, h, left, printedBy) // Add stamps and printed by text on every page
    return y
  }

  // Helper to check for page break and add new page if needed for *continuous* content
  const ensureSpace = async (y: number, minHeightNeeded: number, reportedOnRaw?: string): Promise<number> => {
    if (y + minHeightNeeded >= h - footerMargin) {
      return await addNewPageWithHeader(reportedOnRaw)
    }
    return y
  }

  const printRow = async (p: Parameter, y: number, reportedOnRaw?: string, indent = 0): Promise<number> => {
    let rangeStr = ""
    if (typeof p.range === "string") {
      rangeStr = p.range
    } else {
      const arr = p.range[genderKey as keyof typeof p.range] || []
      for (const r of arr) {
        const { lower, upper } = parseRangeKey(r.rangeKey)
        if (ageDays >= lower && ageDays <= upper) {
          rangeStr = r.rangeValue
          break
        }
      }
      if (!rangeStr && arr.length) rangeStr = arr[arr.length - 1].rangeValue
    }
    rangeStr = rangeStr.replaceAll("/n", "\n")

    const rawValue = String(p.value).trim()
    const valStr = p.value !== "" ? `${p.value}` : "-" // No L/H mark

    const rangeEmpty = rangeStr.trim() === ""
    const unitEmpty = p.unit.trim() === ""
    const fullyMerged = rangeEmpty && unitEmpty

    const nameLines = doc.splitTextToSize(" ".repeat(indent) + p.name, wParam - 4)
    let valueSpan = wValue
    if (fullyMerged) valueSpan = wValue + wUnit + wRange
    else if (unitEmpty) valueSpan = wValue + wUnit

    // Calculate estimated height for this row before printing
    const estimatedRowHeight =
      Math.max(
        nameLines.length,
        doc.splitTextToSize(valStr, valueSpan - 4).length,
        fullyMerged ? 0 : doc.splitTextToSize(rangeStr, wRange - 4).length,
        unitEmpty || fullyMerged ? 0 : doc.splitTextToSize(p.unit, wUnit - 4).length,
      ) * lineH

    y = await ensureSpace(y, estimatedRowHeight, reportedOnRaw) // Check for page break before printing row

    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(0, 0, 0)
    doc.text(nameLines, x1, y + 4)

    // Check if value is out of range and bold it
    const numRange = parseNumericRangeString(rangeStr)
    const numVal = Number.parseFloat(rawValue)
    const isValueOutOfRange = numRange && !isNaN(numVal) && (numVal < numRange.lower || numVal > numRange.upper)
    doc.setFont("helvetica", isValueOutOfRange ? "bold" : "normal") // Apply bold based on isOutOfRange
    doc.text(valStr, x2 + 2, y + 4)

    doc.setFont("helvetica", "normal")
    if (!fullyMerged) {
      if (!unitEmpty) {
        doc.text(p.unit, x3 + 2, y + 4)
      }
      if (!rangeEmpty) {
        doc.text(rangeStr, x4 + 2, y + 4)
      }
    }

    y += estimatedRowHeight

    if (p.subparameters?.length) {
      for (const sp of p.subparameters) {
        y = await printRow(sp, y, reportedOnRaw, indent + 2)
      }
    }
    return y
  }

  const printTest = async (testKey: string, tData: BloodTestData, y: number): Promise<number> => {
    y = await ensureSpace(y, 20, tData.reportedOn) // Estimate space for title + header
    doc.setDrawColor(0, 51, 102).setLineWidth(0.5)
    doc.line(left, y, w - left, y)
    doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(0, 51, 102)
    doc.text(testKey.replace(/_/g, " ").toUpperCase(), w / 2, y + 8, { align: "center" })
    y += 10

    doc.setFontSize(10).setFillColor(0, 51, 102)
    const rowH = 7
    y = await ensureSpace(y, rowH, tData.reportedOn) // Ensure space for table header
    doc.rect(left, y, totalW, rowH, "F")
    doc.setTextColor(255, 255, 255)
    doc.text("PARAMETER", x1 + 2, y + 5)
    doc.text("VALUE", x2 + 2, y + 5)
    doc.text("UNIT", x3 + 2, y + 5)
    doc.text("RANGE", x4 + 2, y + 5)
    y += rowH + 2

    const subheads = tData.subheadings ?? []
    const subNames = subheads.flatMap((s) => s.parameterNames)
    const globals = tData.parameters.filter((p) => !subNames.includes(p.name))

    for (const g of globals) {
      y = await printRow(g, y, tData.reportedOn)
    }

    for (const sh of subheads) {
      const rows = tData.parameters.filter((p) => sh.parameterNames.includes(p.name))
      if (!rows.length) continue

      y = await ensureSpace(y, 6 + lineH * 2, tData.reportedOn) // Estimate for subheading + first row
      doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(0, 51, 102)
      doc.text(sh.title, x1, y + 5)
      y += 6
      for (const r of rows) {
        y = await printRow(r, y, tData.reportedOn, 2)
      }
    }
    y += 3

    if (Array.isArray(tData.descriptions) && tData.descriptions.length) {
      y += 4
      for (const { heading, content } of tData.descriptions) {
        y = await ensureSpace(y, lineH * 2, tData.reportedOn) // Estimate for heading
        doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(0, 51, 102)
        doc.text(heading, x1, y + lineH)
        y += lineH + 2

        doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(0, 0, 0)
        y = parseHTMLContent(doc, content, x1, y, totalW)
        y += 4
      }
    }
    return y
  }

  const generateComparisonReportPDF = async (
    doc: jsPDF,
    data: PatientData,
    historicalTestsData: Record<string, HistoricalTestEntry[]>,
    comparisonSelections: Record<string, ComparisonTestSelection>,
    yPos: number,
    w: number,
    left: number,
    lineH: number, // This lineH is the general one, will use a specific one for comparison
    ageDays: number,
    genderKey: string,
    h: number,
    footerMargin: number,
    addNewPageWithHeader: (reportedOnRaw?: string) => Promise<number>,
    ensureSpace: (y: number, minHeightNeeded: number, reportedOnRaw?: string) => Promise<number>,
  ): Promise<number> => {
    const totalW = w - 2 * left
    const comparisonLineHeight = 4 // Decreased line height for comparison report
    const comparisonRowPadding = 1 // Decreased padding between rows

    const selectedComparisonTests = Object.values(comparisonSelections).filter(
      (selection) =>
        selection.selectedDates.length > 0 && data.bloodtest && data.bloodtest[selection.slugifiedTestName], // Added filter for current registration tests
    )

    let firstTestInComparisonReport = true

    for (const selection of selectedComparisonTests) {
      // Sort relevant historical entries in descending order (latest first)
      const relevantHistoricalEntries = historicalTestsData[selection.slugifiedTestName]
        ?.filter((entry) => selection.selectedDates.includes(entry.reportedOn))
        .sort((a, b) => new Date(b.reportedOn).getTime() - new Date(a.reportedOn).getTime()) // Changed to descending

      if (!relevantHistoricalEntries || relevantHistoricalEntries.length === 0) continue

      // Add new page for each test in comparison report, except the very first one
      if (!firstTestInComparisonReport) {
        yPos = await addNewPageWithHeader(data.createdAt) // Use data.createdAt for comparison report header
      }
      firstTestInComparisonReport = false

      // Determine column headers (dates) - already sorted descending due to relevantHistoricalEntries sort
      const dateHeaders = relevantHistoricalEntries.map((entry) =>
        new Date(entry.reportedOn).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
      )
      const numDateColumns = dateHeaders.length

      // Calculate dynamic column widths
      const fixedColWidthParam = totalW * 0.3 // Parameter Name
      const fixedColWidthRange = totalW * 0.2 // Range (now on the left)
      const remainingWidthForValues = totalW - fixedColWidthParam - fixedColWidthRange
      const dynamicColWidth = remainingWidthForValues / numDateColumns

      // Add test title
      yPos = await ensureSpace(yPos, 20) // Ensure space for title
      doc.setDrawColor(0, 51, 102).setLineWidth(0.5)
      doc.line(left, yPos, w - left, yPos)
      doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(0, 51, 102)
      doc.text(`${selection.testName.toUpperCase()} COMPARISON REPORT`, w / 2, yPos + 8, { align: "center" })
      yPos += 10

      // Add table header
      doc.setFontSize(10).setFillColor(0, 51, 102)
      const rowH = 7
      yPos = await ensureSpace(yPos, rowH) // Ensure space for table header
      doc.rect(left, yPos, totalW, rowH, "F")
      doc.setTextColor(255, 255, 255)
      let currentX = left
      doc.text("PARAMETER", currentX + 2, yPos + 5)
      currentX += fixedColWidthParam
      doc.text("RANGE", currentX + 2, yPos + 5) // Range is now here
      currentX += fixedColWidthRange
      dateHeaders.forEach((header) => {
        doc.text(header, currentX + dynamicColWidth / 2, yPos + 5, { align: "center" }) // Centered date headers
        currentX += dynamicColWidth
      })
      yPos += rowH + 2

      // Get the current test's full data to access subheadings
      const currentTestBloodData = data.bloodtest?.[selection.slugifiedTestName]
      if (!currentTestBloodData) continue // Should not happen if selection exists

      const subheads = currentTestBloodData.subheadings ?? []
      const subNames = subheads.flatMap((s) => s.parameterNames)
      const globalParameters = currentTestBloodData.parameters.filter((p) => !subNames.includes(p.name))

      // Helper to print a single parameter row in comparison format
      const printComparisonParameterRow = async (param: Parameter, indent = 0): Promise<number> => {
        let maxRowHeight = comparisonLineHeight // Use comparison specific line height

        // Determine if it's a text parameter based on the latest value
        let isTextParameter = false
        let latestParamInstance: Parameter | undefined
        if (relevantHistoricalEntries.length > 0) {
          latestParamInstance =
            relevantHistoricalEntries[0].parameters.find((p) => p.name === param.name) ||
            relevantHistoricalEntries[0].parameters
              .flatMap((p) => p.subparameters || [])
              .find((sp) => sp.name === param.name)
          if (
            latestParamInstance &&
            (latestParamInstance.valueType === "text" || isNaN(Number(String(latestParamInstance.value).trim())))
          ) {
            isTextParameter = true
          }
        }

        // Determine common unit and range (take from the latest entry for consistency)
        let commonUnit = ""
        let commonRange = ""
        if (!isTextParameter && relevantHistoricalEntries.length > 0) {
          const latestParam = relevantHistoricalEntries[0].parameters.find((p) => p.name === param.name)
          if (latestParam) {
            commonUnit = latestParam.unit || ""
            if (typeof latestParam.range === "string") {
              commonRange = latestParam.range
            } else {
              const arr = latestParam.range[genderKey as keyof typeof latestParam.range] || []
              for (const r of arr) {
                const { lower, upper } = parseRangeKey(r.rangeKey)
                if (ageDays >= lower && ageDays <= upper) {
                  commonRange = r.rangeValue
                  break
                }
              }
              if (!commonRange && arr.length) commonRange = arr[arr.length - 1].rangeValue
            }
          }
        }

        // Parameter Name column (with unit)
        const paramDisplayName = param.unit && !isTextParameter ? `${param.name} (${param.unit})` : param.name
        const nameLines = doc.splitTextToSize(" ".repeat(indent) + paramDisplayName, fixedColWidthParam - 4)
        doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(0, 0, 0)
        doc.text(nameLines, left + 2, yPos + 4)
        maxRowHeight = Math.max(maxRowHeight, nameLines.length * comparisonLineHeight)

        // Range column (only for non-text parameters)
        if (!isTextParameter) {
          const rangeLines = doc.splitTextToSize(commonRange, fixedColWidthRange - 4)
          doc.text(rangeLines, left + fixedColWidthParam + 2, yPos + 4)
          maxRowHeight = Math.max(maxRowHeight, rangeLines.length * comparisonLineHeight)
        }

        // Dynamic date columns for values
        let currentXForValues = left + fixedColWidthParam + fixedColWidthRange

        if (isTextParameter) {
          // For text parameters, only show the latest value and span it across remaining columns
          const latestEntry = relevantHistoricalEntries[0] // First entry is the latest due to reverse sort
          const paramInstance =
            latestEntry?.parameters.find((p) => p.name === param.name) ||
            latestEntry?.parameters.flatMap((p) => p.subparameters || []).find((sp) => sp.name === param.name)

          let valueToDisplay = "-"
          if (paramInstance) {
            valueToDisplay = String(paramInstance.value).trim()
          }

          doc.setFont("helvetica", "normal").setTextColor(0, 0, 0)
          // The text should span from the start of the 'Range' column to the end of the table.
          const textSpanWidth = totalW - fixedColWidthParam // Total width minus parameter name column
          const valueLines = doc.splitTextToSize(valueToDisplay, textSpanWidth - 4) // -4 for padding
          doc.text(valueLines, left + fixedColWidthParam + 2, yPos + 4, { align: "left" }) // Start from where Range column begins
          maxRowHeight = Math.max(maxRowHeight, valueLines.length * comparisonLineHeight)
        } else {
          // For numeric parameters, iterate through each date column
          relevantHistoricalEntries.forEach((entry, index) => {
            const paramInstance =
              entry.parameters.find((p) => p.name === param.name) ||
              entry.parameters.flatMap((p) => p.subparameters || []).find((sp) => sp.name === param.name)

            let valueToDisplay = "-"
            let isOutOfRange = false

            if (paramInstance) {
              const rawValue = String(paramInstance.value).trim()
              valueToDisplay = rawValue
              const numVal = Number.parseFloat(rawValue)
              const numRange = parseNumericRangeString(commonRange)
              if (numRange && !isNaN(numVal)) {
                if (numVal < numRange.lower || numVal > numRange.upper) {
                  isOutOfRange = true
                }
              }
              doc.setFont("helvetica", isOutOfRange ? "bold" : "normal").setTextColor(0, 0, 0)
            }

            const valueLines = doc.splitTextToSize(valueToDisplay, dynamicColWidth - 4)
            doc.text(valueLines, currentXForValues + dynamicColWidth / 2, yPos + 4, { align: "center" }) // Centered values
            maxRowHeight = Math.max(maxRowHeight, valueLines.length * comparisonLineHeight)
            currentXForValues += dynamicColWidth
          })
        }

        return yPos + maxRowHeight + comparisonRowPadding // Add padding between rows
      }

      // Print global parameters first
      for (const param of globalParameters) {
        yPos = await ensureSpace(yPos, comparisonLineHeight * 2) // Estimate space for a row
        yPos = await printComparisonParameterRow(param)
      }

      // Print subheaded parameters
      for (const sh of subheads) {
        const rows = currentTestBloodData.parameters.filter((p) => sh.parameterNames.includes(p.name))
        if (!rows.length) continue

        yPos = await ensureSpace(yPos, 6 + comparisonLineHeight * 2) // Estimate for subheading + first row
        doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(0, 51, 102)
        doc.text(sh.title, left, yPos + 5)
        yPos += 6
        for (const param of rows) {
          yPos = await ensureSpace(yPos, comparisonLineHeight * 2) // Estimate space for a row
          yPos = await printComparisonParameterRow(param, 2) // Indent subparameters
        }
      }
      yPos += 10 // Space after each comparison table
    }
    return yPos
  }

  await addCover()
  if (!data.bloodtest) return doc.output("blob")

  let currentY: number
  let reportedOnForFirstPage: string | undefined

  // Determine the reportedOn date for the first content page's header
  if (reportType === "comparison") {
    reportedOnForFirstPage = data.createdAt
  } else if (reportType === "combined") {
    const testsToPrint = Object.keys(data.bloodtest || {}).filter((key) => selectedTests.includes(key))
    if (testsToPrint.length > 0) {
      reportedOnForFirstPage = data.bloodtest![testsToPrint[0]]?.reportedOn
    }
  } else {
    // Normal report
    const combinedTestKeys = combinedGroups.flatMap((group) => group.tests)
    const firstTestKey = Object.keys(data.bloodtest || {}).find(
      (key) => selectedTests.includes(key) && (combinedTestKeys.includes(key) || !combinedTestKeys.includes(key)),
    )
    if (firstTestKey) {
      reportedOnForFirstPage = data.bloodtest![firstTestKey]?.reportedOn
    }
  }

  // Add a new page for content if a cover was present, or if we are starting directly with content
  // If skipCover is true, content starts on the existing first page (no doc.addPage() here).
  // If skipCover is false, a cover was added, so we add a new page for content.
  if (!skipCover) {
    doc.addPage()
  }

  if (includeLetterhead) {
    await loadImageAsCompressedJPEG(letterhead.src, 0.5).then((img) => doc.addImage(img, "JPEG", 0, 0, w, h))
  }
  currentY = headerY(reportedOnForFirstPage)
  await addStampsAndPrintedBy(doc, w, h, left, printedBy)

  if (reportType === "comparison") {
    currentY = await generateComparisonReportPDF(
      doc,
      data,
      historicalTestsData,
      comparisonSelections,
      currentY,
      w,
      left,
      lineH, // Pass original lineH, comparison will use its own
      ageDays,
      genderKey,
      h,
      footerMargin,
      addNewPageWithHeader,
      ensureSpace,
    )
  } else if (reportType === "combined") {
    const testsToPrint = Object.keys(data.bloodtest || {}).filter((key) => selectedTests.includes(key))

    // Chunk tests into groups of 5
    const testChunks: string[][] = []
    for (let i = 0; i < testsToPrint.length; i += 5) {
      testChunks.push(testsToPrint.slice(i, i + 5))
    }

    let firstChunk = true // Flag to handle the first chunk on the already prepared page
    for (const chunk of testChunks) {
      if (!firstChunk) {
        // For subsequent chunks, add a new page
        currentY = await addNewPageWithHeader(data.bloodtest![chunk[0]]?.reportedOn)
      }
      firstChunk = false

      for (const testKey of chunk) {
        const tData = data.bloodtest![testKey]
        if (!tData || tData.type === "outsource" || !tData.parameters.length) continue

        currentY = await ensureSpace(currentY, 20, tData.reportedOn)
        currentY = await printTest(testKey, tData, currentY)
        currentY += 10 // Space after each test within a combined page
      }
    }
  } else {
    // Normal report logic (individual tests and combined groups)
    let firstGroupOrTest = true // Flag to handle the first group/test on the already prepared page

    // Process combined groups first
    for (const group of combinedGroups) {
      if (group.tests.length === 0) continue

      const testsInGroup = group.tests.filter((testKey) => selectedTests.includes(testKey) && data.bloodtest![testKey])

      if (testsInGroup.length === 0) continue

      if (!firstGroupOrTest) {
        // For subsequent groups, add a new page
        currentY = await addNewPageWithHeader(data.bloodtest![testsInGroup[0]].reportedOn)
      }
      firstGroupOrTest = false

      for (const testKey of testsInGroup) {
        const tData = data.bloodtest![testKey]
        currentY = await printTest(testKey, tData, currentY)
      }
    }

    // Process remaining individual tests
    const combinedTestKeys = combinedGroups.flatMap((group) => group.tests)
    const remainingTests = Object.keys(data.bloodtest || {}).filter(
      (key) => selectedTests.includes(key) && !combinedTestKeys.includes(key),
    )

    for (const testKey of remainingTests) {
      const tData = data.bloodtest![testKey]
      if (tData.type === "outsource" || !tData.parameters.length) continue

      if (!firstGroupOrTest) {
        // For subsequent individual tests, add a new page
        currentY = await addNewPageWithHeader(tData.reportedOn)
      }
      firstGroupOrTest = false

      currentY = await printTest(testKey, tData, currentY)
    }
  }

  // Final "END OF REPORT" text (stamps are now added per page)
  doc.setFont("helvetica", "italic").setFontSize(7).setTextColor(0)
  currentY = await ensureSpace(currentY, 20) // Ensure space for end of report
  doc.text("--------------------- END OF REPORT ---------------------", w / 2, currentY + 4, { align: "center" })

  return doc.output("blob")
}
