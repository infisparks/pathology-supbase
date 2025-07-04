import { jsPDF } from "jspdf"

import letterhead from "@/public/letterhead.png"
import firstpage from "@/public/first.png"
import stamp from "@/public/stamp.png"
import stamp2 from "@/public/stamp2.png"
import diteImg from "@/public/dite.png" // Import diet image
import eatImg from "@/public/eat.png" // Import exercise image

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
  AiSuggestions, // Import the new type
  AiRecommendationSection, // Declare the new type
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
    img.crossOrigin = "anonymous" // Set crossOrigin to avoid CORS issues [^vercel_knowledge_base]
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
        doc.setFont("helvetica", "normal").setFontSize(9)
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
// AI Suggestion Generation Function
// -----------------------------
export const generateAiSuggestions = async (
  patientData: PatientData,
  bloodtestData: Record<string, BloodTestData>,
): Promise<AiSuggestions> => {
  const apiKey = "AIzaSyA0G8Jhg6yJu-D_OI97_NXgcJTlOes56P8" // Using the API key from the glucose monitoring component
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`

  const defaultResponse: AiSuggestions = {
    diet: {
      title: "Diet Recommendations",
      description: "Based on your general health, here are some diet suggestions:",
      items: [
        {
          heading: "Balanced Diet",
          content: "Focus on a balanced diet with plenty of fruits, vegetables, and lean proteins.",
        },
        { heading: "Hydration", content: "Ensure adequate water intake throughout the day." },
      ],
    },
    exercise: {
      title: "Exercise Recommendations",
      description: "To maintain good health, consider these exercise tips:",
      items: [
        {
          heading: "Regular Activity",
          content: "Aim for at least 30 minutes of moderate physical activity most days.",
        },
        { heading: "Strength & Flexibility", content: "Incorporate strength training and stretching exercises." },
      ],
    },
  }

  // Prepare blood test summary for AI prompt
  let bloodTestSummary = ""
  if (bloodtestData) {
    for (const testKey in bloodtestData) {
      const test = bloodtestData[testKey]
      bloodTestSummary += `\nTest: ${testKey.replace(/_/g, " ")}\n`
      test.parameters.forEach((param) => {
        let rangeStr = ""
        if (typeof param.range === "string") {
          rangeStr = param.range
        } else {
          const genderKey = patientData.gender?.toLowerCase() ?? ""
          const ageDays = patientData.total_day ? Number(patientData.total_day) : Number(patientData.age) * 365
          const arr = param.range[genderKey as keyof typeof param.range] || []
          for (const r of arr) {
            const { lower, upper } = parseRangeKey(r.rangeKey)
            if (ageDays >= lower && ageDays <= upper) {
              rangeStr = r.rangeValue
              break
            }
          }
          if (!rangeStr && arr.length) rangeStr = arr[arr.length - 1].rangeValue
        }

        const numVal = Number.parseFloat(String(param.value).trim())
        const numRange = parseNumericRangeString(rangeStr)
        let status = ""
        if (numRange && !isNaN(numVal)) {
          if (numVal < numRange.lower) status = " (LOW)"
          else if (numVal > numRange.upper) status = " (HIGH)"
          else status = " (NORMAL)"
        }
        bloodTestSummary += `- ${param.name}: ${param.value} ${param.unit} (Range: ${rangeStr})${status}\n`
      })
    }
  }

  const prompt = `Generate short, professional, and actionable diet and exercise recommendations for a patient based on their blood test report.
The patient's details are: Name: ${patientData.name}, Age: ${patientData.age} ${patientData.total_day ? "Days" : "Years"}, Gender: ${patientData.gender}.
Here are the relevant blood test results:\n${bloodTestSummary}

Provide the response as JSON with this structure:
{
  "diet": {
    "title": "Dietary Recommendations",
    "description": "Based on your blood test results, here are some dietary suggestions:",
    "items": [
      {"heading": "Short heading for diet item 1", "content": "Detailed content for diet item 1."},
      {"heading": "Short heading for diet item 2", "content": "Detailed content for diet item 2."}
    ]
  },
  "exercise": {
    "title": "Exercise Recommendations",
    "description": "To complement your diet, consider these exercise tips:",
    "items": [
      {"heading": "Short heading for exercise item 1", "content": "Detailed content for exercise item 1."},
      {"heading": "Short heading for exercise item 2", "content": "Detailed content for exercise item 2."}
    ]
  }
}
Ensure the content is concise and directly related to the blood test values if possible, otherwise provide general health advice.
`

  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: prompt,
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
    },
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      console.error("Gemini API error:", await response.text())
      return defaultResponse
    }

    const result = await response.json()
    const recommendations = JSON.parse(result.candidates[0].content.parts[0].text)
    return recommendations as AiSuggestions
  } catch (e) {
    console.error("Error fetching or parsing Gemini API response:", e)
    return defaultResponse
  }
}

// -----------------------------
// AI Suggestions Page Renderer (Updated)
// -----------------------------
const renderAiSuggestionsPage = async (
  doc: jsPDF,
  patientData: PatientData,
  aiSuggestions: AiSuggestions,
  w: number,
  h: number,
  left: number,
  headerY: (reportedOnRaw?: string) => number,
  addStampsAndPrintedBy: (doc: jsPDF, w: number, h: number, left: number, enteredBy: string) => Promise<void>,
  ensureSpace: (y: number, minHeightNeeded: number, reportedOnRaw?: string) => Promise<number>,
  printedBy: string,
  dietImage: string, // Loaded image data
  exerciseImage: string, // Loaded image data
) => {
  const totalW = w - 2 * left
  let currentY = headerY(patientData.createdAt) // Start below the header

  // Main Title for AI Suggestions page
  currentY = await ensureSpace(currentY, 30, patientData.createdAt)
  doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(0, 51, 102)
  doc.text("AI Expert Suggestion According to Report Value", w / 2, currentY + 10, { align: "center" })
  currentY += 20

  const cardPadding = 5
  const imageSize = 30 // Size for the diet/exercise image
  const textGap = 5 // Gap between image and text content

  // INSERT_YOUR_REWRITE_HERE
  const renderSingleRecommendationCard = async (
    section: AiRecommendationSection,
    image: string,
    startY: number,
  ): Promise<number> => {
    const cardX = left
    const cardWidth = totalW
    const imageWidth = imageSize
    const imageHeight = imageSize
    const textContentX = cardX + cardPadding + imageWidth + textGap
    const textContentWidth = cardWidth - 2 * cardPadding - imageWidth - textGap

    let textBlockHeight = 0 // Height of the text content block, excluding card padding

    // Calculate height for title
    doc.setFont("helvetica", "bold").setFontSize(12)
    const titleHeight = doc.getTextDimensions(section.title, { fontSize: 12 }).h
    textBlockHeight += titleHeight
    textBlockHeight += 2 // Small margin after title

    // Calculate height for description
    doc.setFont("helvetica", "normal").setFontSize(8)
    const descriptionLines = doc.splitTextToSize(section.description, textContentWidth)
    const descriptionHeight = descriptionLines.length * 4 // Using fixed line height for consistency
    textBlockHeight += descriptionHeight
    textBlockHeight += 2 // Small margin after description

    // Calculate height for items
    for (const item of section.items) {
      // Heading height
      doc.setFont("helvetica", "bold").setFontSize(9)
      const headingHeight = doc.getTextDimensions(`• ${item.heading}:`, { fontSize: 9 }).h
      textBlockHeight += headingHeight

      // Content height
      doc.setFont("helvetica", "normal").setFontSize(8)
      const itemContentLines = doc.splitTextToSize(
        item.content,
        textContentWidth - doc.getTextWidth(`• ${item.heading}: `),
      )
      const itemContentHeight = itemContentLines.length * 4 // Using fixed line height for consistency
      textBlockHeight += itemContentHeight
      textBlockHeight += 1 // Small margin after item content
    }

    const cardHeight = Math.max(textBlockHeight + 2 * cardPadding, imageHeight + 2 * cardPadding) // Total card height including padding

    const cardCurrentY = await ensureSpace(startY, cardHeight + 10, patientData.createdAt) // Ensure space for the card + gap

    // Now, draw the card and its content using cardCurrentY as the absolute Y start
    doc.setDrawColor(0, 0, 0).setLineWidth(0.2)
    doc.setFillColor(245, 245, 245) // Light gray background for cards
    doc.rect(cardX, cardCurrentY, cardWidth, cardHeight, "FD")

    // Image on the left
    doc.addImage(image, "JPEG", cardX + cardPadding, cardCurrentY + cardPadding, imageWidth, imageHeight)

    // Text content area starts after the image
    let textDrawY = cardCurrentY + cardPadding // Start drawing text from here

    // Draw title
    doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(0, 51, 102)
    doc.text(section.title, textContentX, textDrawY + titleHeight / 2) // Vertically center title in its line
    textDrawY += titleHeight + 2

    // Draw description
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(50, 50, 50)
    doc.text(descriptionLines, textContentX, textDrawY)
    textDrawY += descriptionHeight + 2

    // Draw items
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(0, 0, 0)
    for (const item of section.items) {
      // Inside the loop for section.items:
      // textY is the current Y position for the start of the item.
      // Ensure space before drawing this item
      doc.setFont("helvetica", "bold").setFontSize(9)
      const headingText = `• ${item.heading}:`
      const headingWidth = doc.getTextWidth(headingText)
      const headingLineHeight = 4 // Approx for 9pt font

      doc.setFont("helvetica", "normal").setFontSize(8)
      const itemContentLineHeight = 4 // Approx for 8pt font

      // Determine how much of the content fits on the first line after the heading
      const firstLineContentWidth = textContentWidth - headingWidth
      const firstLineContent = doc.splitTextToSize(item.content, firstLineContentWidth)[0] || ""
      const remainingContent = item.content.substring(firstLineContent.length).trim()

      // Calculate height of subsequent content lines (aligned with textContentX)
      const subsequentContentLines = doc.splitTextToSize(remainingContent, textContentX) // Use textContentX for full width
      const subsequentContentHeight = subsequentContentLines.length * itemContentLineHeight

      // Total height for this item (heading line + subsequent content lines)
      const totalItemHeight = headingLineHeight + subsequentContentHeight

      textDrawY = await ensureSpace(textDrawY, totalItemHeight + 1, patientData.createdAt) // +1 for small gap after item

      // Draw heading
      doc.setFont("helvetica", "bold").setFontSize(9)
      doc.text(headingText, textContentX, textDrawY)

      // Draw first part of content on the same line
      doc.setFont("helvetica", "normal").setFontSize(8)
      doc.text(firstLineContent, textContentX + headingWidth, textDrawY)

      // Move to the next line for the rest of the content
      let currentContentY = textDrawY + headingLineHeight

      // Draw subsequent content lines, aligned with the main text content area
      if (subsequentContentLines.length > 0) {
        doc.text(subsequentContentLines, textContentX, currentContentY)
        currentContentY += subsequentContentLines.length * itemContentLineHeight
      }

      // Update textY for the next item, adding a small gap
      textDrawY = currentContentY + 1
    }
    return cardCurrentY + cardHeight + 10 // Return Y position after this card + gap
  }

  // Render Diet Card
  currentY = await renderSingleRecommendationCard(aiSuggestions.diet, dietImage, currentY)

  // Render Exercise Card below Diet Card
  currentY = await renderSingleRecommendationCard(aiSuggestions.exercise, exerciseImage, currentY)

  return currentY
}

// -----------------------------
// Main PDF Generation Function (Updated)
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
  aiSuggestions?: AiSuggestions,
  includeAiSuggestionsPage = false,
) => {
  const doc = new jsPDF("p", "mm", "a4")
  
  const firstTestKey = Object.keys(data.bloodtest || {})[0]
  const printedBy = data.bloodtest?.[firstTestKey]?.enteredBy ?? "Lab System"
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
  const footerMargin = 23

  const STAMP_WIDTH = 40
  const STAMP_HEIGHT = 30
  const STAMP_BOTTOM_MARGIN = 21

  // Load all images once at the beginning
  const [loadedLetterhead, loadedFirstPage, loadedStamp, loadedStamp2, loadedDietImage, loadedExerciseImage] =
    await Promise.all([
      includeLetterhead ? loadImageAsCompressedJPEG(letterhead.src, 0.5) : Promise.resolve(null),
      !skipCover ? loadImageAsCompressedJPEG(firstpage.src, 0.5) : Promise.resolve(null),
      loadImageAsCompressedJPEG(stamp.src, 0.5),
      loadImageAsCompressedJPEG(stamp2.src, 0.5),
      loadImageAsCompressedJPEG(diteImg.src, 0.7),
      loadImageAsCompressedJPEG(eatImg.src, 0.7),
    ])

  const addStampsAndPrintedBy = async (doc: jsPDF, w: number, h: number, left: number, enteredBy: string) => {
    const sy = h - STAMP_HEIGHT - STAMP_BOTTOM_MARGIN
    const sx2 = w - left - STAMP_WIDTH
    if (loadedStamp2) doc.addImage(loadedStamp2, "JPEG", sx2, sy, STAMP_WIDTH, STAMP_HEIGHT)
    const sx1 = (w - STAMP_WIDTH) / 2
    if (loadedStamp) doc.addImage(loadedStamp, "JPEG", sx1, sy, STAMP_WIDTH, STAMP_HEIGHT)
    doc.setFont("helvetica", "normal").setFontSize(10)
    doc.text(`Printed by ${enteredBy}`, left, sy + STAMP_HEIGHT - 1)
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

    const mergedPatientId =
      data.patientId && data.registration_id
        ? `${data.patientId}-${data.registration_id}`
        : data.patientId || data.registration_id || "-"

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

  const addNewPageWithHeader = async (reportedOnRaw?: string) => {
    doc.addPage()
    if (loadedLetterhead) {
      doc.addImage(loadedLetterhead, "JPEG", 0, 0, w, h)
    }
    const y = headerY(reportedOnRaw)
    await addStampsAndPrintedBy(doc, w, h, left, printedBy)
    return y
  }

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
    const valStr = p.value !== "" ? `${p.value}` : "-"

    const rangeEmpty = rangeStr.trim() === ""
    const unitEmpty = p.unit.trim() === ""
    const fullyMerged = rangeEmpty && unitEmpty

    const nameLines = doc.splitTextToSize(" ".repeat(indent) + p.name, wParam - 4)
    let valueSpan = wValue
    if (fullyMerged) valueSpan = wValue + wUnit + wRange
    else if (unitEmpty) valueSpan = wValue + wUnit

    const estimatedRowHeight =
      Math.max(
        nameLines.length,
        doc.splitTextToSize(valStr, valueSpan - 4).length,
        fullyMerged ? 0 : doc.splitTextToSize(rangeStr, wRange - 4).length,
        unitEmpty || fullyMerged ? 0 : doc.splitTextToSize(p.unit, wUnit - 4).length,
      ) * lineH

    y = await ensureSpace(y, estimatedRowHeight, reportedOnRaw)

    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(0, 0, 0)
    doc.text(nameLines, x1, y + 4)

    const numRange = parseNumericRangeString(rangeStr)
    const numVal = Number.parseFloat(rawValue)
    const isValueOutOfRange = numRange && !isNaN(numVal) && (numVal < numRange.lower || numVal > numRange.upper)

    doc.setFont("helvetica", isValueOutOfRange ? "bold" : "normal")
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
    y = await ensureSpace(y, 20, tData.reportedOn)

    doc.setDrawColor(0, 51, 102).setLineWidth(0.5)
    doc.line(left, y, w - left, y)
    doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(0, 51, 102)
    doc.text(testKey.replace(/_/g, " ").toUpperCase(), w / 2, y + 8, { align: "center" })
    y += 10

    doc.setFontSize(10).setFillColor(0, 51, 102)
    const rowH = 7
    y = await ensureSpace(y, rowH, tData.reportedOn)
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

      y = await ensureSpace(y, 6 + lineH * 2, tData.reportedOn)
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
        y = await ensureSpace(y, lineH * 2, tData.reportedOn)
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
    lineH: number,
    ageDays: number,
    genderKey: string,
    h: number,
    footerMargin: number,
    addNewPageWithHeader: (reportedOnRaw?: string) => Promise<number>,
    ensureSpace: (y: number, minHeightNeeded: number, reportedOnRaw?: string) => Promise<number>,
  ): Promise<number> => {
    const totalW = w - 2 * left
    const comparisonLineHeight = 4
    const comparisonRowPadding = 1

    const selectedComparisonTests = Object.values(comparisonSelections).filter(
      (selection) =>
        selection.selectedDates.length > 0 && data.bloodtest && data.bloodtest[selection.slugifiedTestName],
    )

    let firstTestInComparisonReport = true

    for (const selection of selectedComparisonTests) {
      const relevantHistoricalEntries = historicalTestsData[selection.slugifiedTestName]
        ?.filter((entry) => selection.selectedDates.includes(entry.reportedOn))
        .sort((a, b) => new Date(b.reportedOn).getTime() - new Date(a.reportedOn).getTime())

      if (!relevantHistoricalEntries || relevantHistoricalEntries.length === 0) continue

      if (!firstTestInComparisonReport) {
        yPos = await addNewPageWithHeader(data.createdAt)
      }
      firstTestInComparisonReport = false

      const dateHeaders = relevantHistoricalEntries.map((entry) =>
        new Date(entry.reportedOn).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
      )
      const numDateColumns = dateHeaders.length

      const fixedColWidthParam = totalW * 0.3
      const fixedColWidthRange = totalW * 0.2
      const remainingWidthForValues = totalW - fixedColWidthParam - fixedColWidthRange
      const dynamicColWidth = remainingWidthForValues / numDateColumns

      yPos = await ensureSpace(yPos, 20, data.createdAt)
      doc.setDrawColor(0, 51, 102).setLineWidth(0.5)
      doc.line(left, yPos, w - left, yPos)
      doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(0, 51, 102)
      doc.text(`${selection.testName.toUpperCase()} COMPARISON REPORT`, w / 2, yPos + 8, { align: "center" })
      yPos += 10

      doc.setFontSize(10).setFillColor(0, 51, 102)
      const rowH = 7
      yPos = await ensureSpace(yPos, rowH, data.createdAt)
      doc.rect(left, yPos, totalW, rowH, "F")
      doc.setTextColor(255, 255, 255)
      let currentX = left
      doc.text("PARAMETER", currentX + 2, yPos + 5)
      currentX += fixedColWidthParam
      doc.text("RANGE", currentX + 2, yPos + 5)
      currentX += fixedColWidthRange
      dateHeaders.forEach((header) => {
        doc.text(header, currentX + dynamicColWidth / 2, yPos + 5, { align: "center" })
        currentX += dynamicColWidth
      })
      yPos += rowH + 2

      const currentTestBloodData = data.bloodtest?.[selection.slugifiedTestName]
      if (!currentTestBloodData) continue

      const subheads = currentTestBloodData.subheadings ?? []
      const subNames = subheads.flatMap((s) => s.parameterNames)
      const globalParameters = currentTestBloodData.parameters.filter((p) => !subNames.includes(p.name))

      const printComparisonParameterRow = async (param: Parameter, indent = 0): Promise<number> => {
        let maxRowHeight = comparisonLineHeight

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

        const paramDisplayName = param.unit && !isTextParameter ? `${param.name} (${param.unit})` : param.name
        const nameLines = doc.splitTextToSize(" ".repeat(indent) + paramDisplayName, fixedColWidthParam - 4)
        doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(0, 0, 0)
        doc.text(nameLines, left + 2, yPos + 4)
        maxRowHeight = Math.max(maxRowHeight, nameLines.length * comparisonLineHeight)

        if (!isTextParameter) {
          const rangeLines = doc.splitTextToSize(commonRange, fixedColWidthRange - 4)
          doc.text(rangeLines, left + fixedColWidthParam + 2, yPos + 4)
          maxRowHeight = Math.max(maxRowHeight, rangeLines.length * comparisonLineHeight)
        }

        let currentXForValues = left + fixedColWidthParam + fixedColWidthRange
        if (isTextParameter) {
          const latestEntry = relevantHistoricalEntries[0]
          const paramInstance =
            latestEntry?.parameters.find((p) => p.name === param.name) ||
            latestEntry?.parameters.flatMap((p) => p.subparameters || []).find((sp) => sp.name === param.name)
          let valueToDisplay = "-"
          if (paramInstance) {
            valueToDisplay = String(paramInstance.value).trim()
          }
          doc.setFont("helvetica", "normal").setTextColor(0, 0, 0)
          const textSpanWidth = totalW - fixedColWidthParam
          const valueLines = doc.splitTextToSize(valueToDisplay, textSpanWidth - 4)
          doc.text(valueLines, left + fixedColWidthParam + 2, yPos + 4, { align: "left" })
          maxRowHeight = Math.max(maxRowHeight, valueLines.length * comparisonLineHeight)
        } else {
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
                if (numVal < numRange.lower) {
                  isOutOfRange = true
                } else if (numVal > numRange.upper) {
                  isOutOfRange = true
                }
              }
              doc.setFont("helvetica", isOutOfRange ? "bold" : "normal").setTextColor(0, 0, 0)
            }
            const valueLines = doc.splitTextToSize(valueToDisplay, dynamicColWidth - 4)
            doc.text(valueLines, currentXForValues + dynamicColWidth / 2, yPos + 4, { align: "center" })
            maxRowHeight = Math.max(maxRowHeight, valueLines.length * comparisonLineHeight)
            currentXForValues += dynamicColWidth
          })
        }
        return yPos + maxRowHeight + comparisonRowPadding
      }

      for (const param of globalParameters) {
        yPos = await ensureSpace(yPos, comparisonLineHeight * 2, data.createdAt)
        yPos = await printComparisonParameterRow(param)
      }

      for (const sh of subheads) {
        const rows = currentTestBloodData.parameters.filter((p) => sh.parameterNames.includes(p.name))
        if (!rows.length) continue

        yPos = await ensureSpace(yPos, 6 + comparisonLineHeight * 2, data.createdAt)
        doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(0, 51, 102)
        doc.text(sh.title, left, yPos + 5)
        yPos += 6
        for (const param of rows) {
          yPos = await ensureSpace(yPos, comparisonLineHeight * 2, data.createdAt)
          yPos = await printComparisonParameterRow(param, 2)
        }
      }
      yPos += 10
    }
    return yPos
  }

  // --- Main Page Flow ---
  // 1. Cover Page (if not skipped)
  if (!skipCover) {
    if (loadedFirstPage) {
      doc.addImage(loadedFirstPage, "JPEG", 0, 0, w, h)
    }
  }

  // 2. AI Suggestions Page (if requested)
  if (includeAiSuggestionsPage && aiSuggestions) {
    doc.addPage() // Add page for AI suggestions (this will be page 2 if cover exists, page 1 otherwise)
    if (loadedLetterhead) {
      doc.addImage(loadedLetterhead, "JPEG", 0, 0, w, h)
    }
    // Add header and stamps for the AI suggestions page
    const aiPageY = headerY(data.createdAt)
    await addStampsAndPrintedBy(doc, w, h, left, printedBy)

    await renderAiSuggestionsPage(
      doc,
      data,
      aiSuggestions,
      w,
      h,
      left,
      headerY, // Passed for reference, not called internally by renderAiSuggestionsPage
      addStampsAndPrintedBy, // Passed for reference
      ensureSpace,
      printedBy, // Passed for reference
      loadedDietImage!,
      loadedExerciseImage!,
    )
  }

  // 3. Main Report Content Pages
  // Always add a new page for the actual report content.
// 3. Main Report Content Pages
let currentY = headerY(data.createdAt);
let isFirstReportPage = doc.getNumberOfPages() === 1


if (!isFirstReportPage) {
  doc.addPage()
  if (loadedLetterhead) {
    doc.addImage(loadedLetterhead, "JPEG", 0, 0, w, h)
  }
  currentY = headerY(data.createdAt)
  await addStampsAndPrintedBy(doc, w, h, left, printedBy)
} else {
  if (loadedLetterhead) {
    doc.addImage(loadedLetterhead, "JPEG", 0, 0, w, h)
  }
  currentY = headerY(data.createdAt)
  await addStampsAndPrintedBy(doc, w, h, left, printedBy)
}

  if (!data.bloodtest) return doc.output("blob")

  if (reportType === "comparison") {
    currentY = await generateComparisonReportPDF(
      doc,
      data,
      historicalTestsData,
      comparisonSelections,
      currentY,
      w,
      left,
      lineH,
      ageDays,
      genderKey,
      h,
      footerMargin,
      addNewPageWithHeader,
      ensureSpace,
    )
  } else if (reportType === "combined") {
    const testsToPrint = Object.keys(data.bloodtest || {}).filter((key) => selectedTests.includes(key))
    const testChunks: string[][] = []
    for (let i = 0; i < testsToPrint.length; i += 5) {
      testChunks.push(testsToPrint.slice(i, i + 5))
    }
    let firstChunk = true
    for (const chunk of testChunks) {
      if (!firstChunk) {
        currentY = await addNewPageWithHeader(data.bloodtest![chunk[0]]?.reportedOn)
      }
      firstChunk = false
      for (const testKey of chunk) {
        const tData = data.bloodtest![testKey]
        if (!tData || tData.type === "outsource" || !tData.parameters.length) continue
        currentY = await ensureSpace(currentY, 20, tData.reportedOn)
        currentY = await printTest(testKey, tData, currentY)
        currentY += 10
      }
    }
  } else {
    let firstGroupOrTest = true
    for (const group of combinedGroups) {
      if (group.tests.length === 0) continue
      const testsInGroup = group.tests.filter((testKey) => selectedTests.includes(testKey) && data.bloodtest![testKey])
      if (testsInGroup.length === 0) continue

      if (!firstGroupOrTest) {
        currentY = await addNewPageWithHeader(data.bloodtest![testsInGroup[0]].reportedOn)
      }
      firstGroupOrTest = false
      for (const testKey of testsInGroup) {
        const tData = data.bloodtest![testKey]
        currentY = await printTest(testKey, tData, currentY)
      }
    }

    const combinedTestKeys = combinedGroups.flatMap((group) => group.tests)
    const remainingTests = Object.keys(data.bloodtest || {}).filter(
      (key) => selectedTests.includes(key) && !combinedTestKeys.includes(key),
    )
    for (const testKey of remainingTests) {
      const tData = data.bloodtest![testKey]
      if (tData.type === "outsource" || !tData.parameters.length) continue

      if (!firstGroupOrTest) {
        currentY = await addNewPageWithHeader(tData.reportedOn)
      }
      firstGroupOrTest = false
      currentY = await printTest(testKey, tData, currentY)
    }
  }

  doc.setFont("helvetica", "italic").setFontSize(7).setTextColor(0)
  currentY = await ensureSpace(currentY, 20, data.createdAt)
  doc.text("--------------------- END OF REPORT ---------------------", w / 2, currentY + 4, { align: "center" })

  return doc.output("blob")
}
