"use client"

import type React from "react"
import { useEffect, useState } from "react"
import { useForm, type SubmitHandler, type Path } from "react-hook-form"
import { useParams, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase" // Assuming your Supabase client is configured here
import { Droplet, User, AlertCircle, CheckCircle, Loader2, Calculator } from "lucide-react" // Using Lucide React icons

/* ─────────────────── Types ─────────────────── */
interface SubParameterValue {
  name: string
  unit: string
  value: string | number
  range: string
  formula?: string
  valueType: "number" | "text"
}
interface TestParameterValue {
  name: string
  unit: string
  value: string | number
  range: string
  formula?: string
  valueType: "number" | "text"
  visibility?: string
  subparameters?: SubParameterValue[]
  suggestions?: { shortName: string; description: string }[]
}

interface SubHeading {
  title: string
  parameterNames: string[]
  is100?: boolean | string
}

// Corrected TestStructure interface to match database columns
interface TestStructure {
  parameter: TestParameterValue[] // Matches 'parameter' column
  sub_heading: SubHeading[] // Matches 'sub_heading' column
}

interface TestValueEntry {
  testId: string
  testName: string
  testType: string
  parameters: TestParameterValue[]
  subheadings?: SubHeading[]
  selectedParameters?: string[]
}

interface BloodValuesFormInputs {
  registrationId: string
  tests: TestValueEntry[]
}
export type IndexedParam = TestParameterValue & { originalIndex: number }

/* ───────────── Helpers ───────────── */
const parseRange = (rangeStr: string): { min?: number; max?: number } => {
  const range = rangeStr.trim()
  if (range === "") return {}

  const hyphenParts = range.split("-")
  if (hyphenParts.length === 2) {
    const min = Number.parseFloat(hyphenParts[0])
    const max = Number.parseFloat(hyphenParts[1])
    if (!isNaN(min) && !isNaN(max)) return { min, max }
  }

  if (range.startsWith("<")) {
    const max = Number.parseFloat(range.slice(1))
    if (!isNaN(max)) return { max }
  } else if (range.startsWith(">")) {
    const min = Number.parseFloat(range.slice(1))
    if (!isNaN(min)) return { min }
  }

  if (range.startsWith("≤")) {
    const max = Number.parseFloat(range.slice(1))
    if (!isNaN(max)) return { max }
  } else if (range.startsWith("≥")) {
    const min = Number.parseFloat(range.slice(1))
    if (!isNaN(min)) return { min }
  }

  return {}
}

const parseRangeKey = (key: string) => {
  const unit = key.trim().slice(-1)
  const [l, u] = key.slice(0, -1).split("-").map(Number)
  const mul = unit === "y" ? 365 : unit === "m" ? 30 : 1
  return { lower: l * mul, upper: u * mul }
}
const isNumeric = (s: string) => !isNaN(+s) && isFinite(+s)

/* ---- Helper to format numbers with up to 3 decimals, dropping trailing zeros ---- */
const fmt3 = (n: number) => n.toFixed(3).replace(/\.?0+$/, "")

/* ---------- dropdown position helper ---------- */
interface SuggestPos {
  t: number
  p: number
  x: number
  y: number
  width: number
}

/* ------------------------------------------------------------------ */
const BloodValuesForm: React.FC = () => {
  const router = useRouter()
  const params = useParams()
  const registrationId = params.registrationId as string

  const [loading, setLoading] = useState(true)
  const [dbText, setDbText] = useState<string[]>([])
  const [suggest, setSuggest] = useState<string[]>([])
  const [showSug, setShowSug] = useState<SuggestPos | null>(null)
  const [warn100, setWarn100] = useState<Record<string, boolean>>({})
  const [patientDetails, setPatientDetails] = useState<{
    id: number
    age: number
    gender: string
    patientId: string
  } | null>(null)

  const {
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<BloodValuesFormInputs>({
    defaultValues: { registrationId: registrationId || "", tests: [] },
  })

  /* ── Fetch autocomplete values ── */
  useEffect(() => {
    ;(async () => {
      try {
        const { data, error } = await supabase.from("autocomplete_values").select("value")
        if (error) throw error
        setDbText(data.map((row) => row.value))
      } catch (e) {
        console.error("Error fetching autocomplete values:", e)
      }
    })()
  }, [])

  /* ── Fetch patient’s booked tests and definitions ── */
  useEffect(() => {
    if (!registrationId) return
    ;(async () => {
      try {
        // Fetch registration details
        const { data: registrationData, error: registrationError } = await supabase
          .from("registration")
          .select("patient_id, bloodtest_data, bloodtest_detail")
          .eq("id", registrationId)
          .single()

        if (registrationError || !registrationData) {
          console.error("Error fetching registration:", registrationError)
          setLoading(false)
          return
        }

        const patientId = registrationData.patient_id
        const bookedTests = registrationData.bloodtest_data || []
        const storedBloodtestDetail = registrationData.bloodtest_detail || {}

        // Fetch patient details for age and gender
        const { data: patientData, error: patientError } = await supabase
          .from("patientdetial")
          .select("id, age, gender, patient_id")
          .eq("id", patientId)
          .single()

        if (patientError || !patientData) {
          console.error("Error fetching patient details:", patientError)
          setLoading(false)
          return
        }

        setPatientDetails({
          id: patientData.id,
          age: patientData.age,
          gender: patientData.gender,
          patientId: patientData.patient_id,
        })

        const ageDays = patientData.age * 365 // Assuming age is in years, convert to days
        const genderKey = patientData.gender?.toLowerCase() === "male" ? "male" : "female"

        const tests: TestValueEntry[] = await Promise.all(
          bookedTests.map(async (bt: any) => {
            // Fetch test structure from blood_test table, selecting 'parameter' and 'sub_heading'
            const { data: testDefData, error: testDefError } = await supabase
              .from("blood_test")
              .select("parameter, sub_heading") // Corrected select statement
              .eq("test_name", bt.testName)
              .single()

            if (testDefError || !testDefData) {
              console.warn(`Test definition not found for ${bt.testName}:`, testDefError)
              return {
                testId: bt.testId,
                testName: bt.testName,
                testType: bt.testType,
                parameters: [],
                subheadings: [],
                selectedParameters: bt.selectedParameters,
              } as TestValueEntry
            }

            // Access parameters and subheadings directly from testDefData
            const allParams = Array.isArray(testDefData.parameter) ? testDefData.parameter : []
            const subheadings = Array.isArray(testDefData.sub_heading) ? testDefData.sub_heading : []

            const wanted = bt.selectedParameters?.length
              ? allParams.filter((p: any) => bt.selectedParameters.includes(p.name))
              : allParams

            const params: TestParameterValue[] = wanted.map((p: any) => {
              const ranges = p.range?.[genderKey] || []
              let normal = ""
              for (const r of ranges) {
                const { lower, upper } = parseRangeKey(r.rangeKey)
                if (ageDays >= lower && ageDays <= upper) {
                  normal = r.rangeValue
                  break
                }
              }
              if (!normal && ranges.length) normal = ranges[ranges.length - 1].rangeValue

              const testKey = bt.testName
                .toLowerCase()
                .replace(/\s+/g, "_")
                .replace(/[.#$[\]]/g, "")

              const saved = storedBloodtestDetail?.[testKey]?.parameters?.find((q: any) => q.name === p.name)

              let subps
              if (Array.isArray(p.subparameters)) {
                subps = p.subparameters.map((s: any) => {
                  const sr = s.range?.[genderKey] || []
                  let sNorm = ""
                  for (const x of sr) {
                    const { lower, upper } = parseRangeKey(x.rangeKey)
                    if (ageDays >= lower && ageDays <= upper) {
                      sNorm = x.rangeValue
                      break
                    }
                  }
                  if (!sNorm && sr.length) sNorm = sr[sr.length - 1].rangeValue
                  const savedSp = saved?.subparameters?.find((z: any) => z.name === s.name)
                  return {
                    name: s.name,
                    unit: s.unit,
                    value: savedSp ? savedSp.value : "",
                    range: sNorm,
                    formula: s.formula || "",
                    valueType: s.valueType || "number",
                  } as SubParameterValue
                })
              }
              return {
                name: p.name,
                unit: p.unit,
                value: saved ? saved.value : p.defaultValue !== undefined ? p.defaultValue : "",
                range: normal,
                formula: p.formula || "",
                valueType: p.valueType || "number",
                visibility: p.visibility ?? "visible",
                ...(subps ? { subparameters: subps } : {}),
                ...(p.suggestions ? { suggestions: p.suggestions } : {}),
              } as TestParameterValue
            })

            return {
              testId: bt.testId,
              testName: bt.testName,
              testType: bt.testType,
              parameters: params,
              subheadings: subheadings, // Use the fetched subheadings
              selectedParameters: bt.selectedParameters,
            } as TestValueEntry
          }),
        )

        reset({ registrationId, tests })
      } catch (e) {
        console.error("Error in fetching data for form:", e)
      } finally {
        setLoading(false)
      }
    })()
  }, [registrationId, reset])

  /* ══════════════ “Sum to 100” warning logic ══════════════ */
  const testsWatch = watch("tests")
  useEffect(() => {
    const warn: Record<string, boolean> = {}

    testsWatch.forEach((t, tIdx) => {
      t.subheadings?.forEach((sh, shIdx) => {
        if (!(sh.is100 === true || sh.is100 === "true")) return
        const tag = `${tIdx}-${shIdx}`
        const idxs = sh.parameterNames.map((n) => t.parameters.findIndex((p) => p.name === n)).filter((i) => i >= 0)
        let sum = 0
        idxs.forEach((i) => {
          const v = +testsWatch[tIdx].parameters[i].value
          if (!isNaN(v)) sum += v
        })
        warn[tag] = sum > 100.0001
      })
    })

    setWarn100(warn)
  }, [testsWatch])

  /* ══════════════ Formula recalculation on Shift key ══════════════ */
  useEffect(() => {
    const runAll = () => {
      const tArr = watch("tests")
      tArr.forEach((t, tIdx) => {
        const nums: Record<string, number> = {}
        t.parameters.forEach((p) => {
          const v = +p.value
          if (!isNaN(v)) nums[p.name] = v
        })
        t.parameters.forEach((p, pIdx) => {
          if (p.formula && p.valueType === "number") {
            let expr = p.formula
            Object.entries(nums).forEach(([k, v]) => {
              expr = expr.replace(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), v + "")
            })
            try {
              const r = Function('"use strict";return (' + expr + ")")()
              if (!isNaN(r)) {
                setValue(`tests.${tIdx}.parameters.${pIdx}.value`, fmt3(r), { shouldValidate: false })
              }
            } catch {}
          }
        })
      })
    }
    const onKey = (e: KeyboardEvent) => e.key === "Shift" && runAll()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [watch, setValue])

  /* ══════════════ Numeric Change: allow up to 3 decimal places or “<” / “>” prefixes ══════════════ */
  const numericChange = (v: string, t: number, p: number, sp?: number) => {
    if (v === "" || v === "-") {
      // allow empty or single minus
    } else {
      // allow numbers with up to 3 decimals, optionally prefixed by “<” or “>”
      const regex = /^[<>]?-?\d*(\.\d{0,3})?$/
      if (!regex.test(v)) return
    }
    const path =
      sp == null ? `tests.${t}.parameters.${p}.value` : `tests.${t}.parameters.${p}.subparameters.${sp}.value`
    setValue(path as Path<BloodValuesFormInputs>, v, { shouldValidate: false })
  }

  /* ══════════════ Build suggestions for text inputs ══════════════ */
  const buildMatches = (param: TestParameterValue, q: string): string[] => {
    if (Array.isArray(param.suggestions) && param.suggestions.length > 0) {
      const pool = param.suggestions.map((s) => s.description)
      return q ? pool.filter((d) => d.toLowerCase().includes(q)) : pool
    }
    return q ? dbText.filter((s) => s.toLowerCase().includes(q)) : dbText
  }

  const showDropdown = (t: number, p: number, rect: DOMRect, q: string) => {
    const currentParam = watch("tests")[t].parameters[p]
    const matches = buildMatches(currentParam, q)
    setSuggest(matches)
    if (matches.length) {
      setShowSug({
        t,
        p,
        x: rect.left + window.scrollX,
        y: rect.bottom + window.scrollY,
        width: rect.width,
      })
    } else {
      setShowSug(null)
    }
  }

  const textChange = (txt: string, t: number, p: number, rect: DOMRect) => {
    setValue(`tests.${t}.parameters.${p}.value` as Path<BloodValuesFormInputs>, txt, {
      shouldValidate: false,
    })
    showDropdown(t, p, rect, txt.trim().toLowerCase())
  }

  const pickSug = (val: string, t: number, p: number) => {
    setValue(`tests.${t}.parameters.${p}.value` as Path<BloodValuesFormInputs>, val)
    setSuggest([])
    setShowSug(null)
  }

  /* ══════════════ Single‐formula calculation via button ══════════════ */
  const calcFormulaOnce = (tIdx: number, pIdx: number) => {
    const data = watch("tests")[tIdx]
    const p = data.parameters[pIdx]
    if (!p.formula || p.valueType !== "number") return
    const nums: Record<string, number> = {}
    data.parameters.forEach((x) => {
      const v = +x.value
      if (!isNaN(v)) nums[x.name] = v
    })
    let expr = p.formula
    Object.entries(nums).forEach(([k, v]) => {
      expr = expr.replace(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), v + "")
    })
    try {
      const r = Function('"use strict";return (' + expr + ")")()
      if (!isNaN(r)) setValue(`tests.${tIdx}.parameters.${pIdx}.value`, fmt3(r))
    } catch {}
  }

  /* ══════════════ Handle “fill remaining” for subheadings that sum to 100 ══════════════ */
  const fillRemaining = (tIdx: number, sh: SubHeading, lastIdx: number) => {
    const test = watch("tests")[tIdx]
    const idxs = sh.parameterNames.map((n) => test.parameters.findIndex((p) => p.name === n)).filter((i) => i >= 0)
    let total = 0
    idxs.slice(0, -1).forEach((i) => {
      const v = +test.parameters[i].value
      if (!isNaN(v)) total += v
    })

    const remainder = 100 - total
    const integerValue = Math.round(remainder)
    setValue(`tests.${tIdx}.parameters.${lastIdx}.value`, integerValue.toString(), { shouldValidate: false })
  }

  /* ══════════════ Submit handler: write back to Supabase ══════════════ */
  const onSubmit: SubmitHandler<BloodValuesFormInputs> = async (data) => {
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError
      const fullEmail = userData.user?.email ?? ""
      const enteredBy = fullEmail.split("@")[0] || "unknown" // Fallback if email is not available

      // Fetch existing bloodtest_detail to merge BEFORE processing tests
      const { data: existingRegData, error: fetchError } = await supabase
        .from("registration")
        .select("bloodtest_detail")
        .eq("id", data.registrationId)
        .single()

      if (fetchError) throw fetchError

      const existingBloodtestDetail = existingRegData?.bloodtest_detail || {}

      const bloodtestDetail: Record<string, any> = {}

      for (const t of data.tests) {
        const key = t.testName
          .toLowerCase()
          .replace(/\s+/g, "_")
          .replace(/[.#$[\]]/g, "")
        const now = new Date().toISOString()

        const params = t.parameters
          .map((p) => {
            const subs = p.subparameters?.filter((sp) => sp.value !== "") ?? []
            if (p.value !== "" || subs.length) {
              const obj: any = { ...p, subparameters: subs }

              // If the entered value starts with ">" or "<", keep it as a string
              const strValue = String(p.value)
              if (/^[<>]/.test(strValue)) {
                obj.value = strValue
              } else if (p.valueType === "number" && p.value !== "") {
                // Otherwise, convert to number (or preserve trailing zero if present)
                const numValue = +p.value
                obj.value = strValue.includes(".") && strValue.endsWith("0") ? strValue : numValue
              }

              // Handle subparameters similarly
              subs.forEach((sp) => {
                const spStr = String(sp.value)
                if (/^[<>]/.test(spStr)) {
                  sp.value = spStr
                } else if (sp.valueType === "number" && sp.value !== "") {
                  const spNum = +sp.value
                  sp.value = spStr.includes(".") && spStr.endsWith("0") ? spStr : spNum
                }
              })

              return obj
            }
            return null
          })
          .filter(Boolean) as TestParameterValue[]

        bloodtestDetail[key] = {
          parameters: params,
          testId: t.testId,
          subheadings: t.subheadings || [],
          createdAt: existingBloodtestDetail[key]?.createdAt || now, // Preserve existing createdAt or set new
          reportedOn: now, // Always update reportedOn to current time
          enteredBy, // Always update enteredBy to current user
        }
      }

      const mergedBloodtestDetail = {
        ...existingBloodtestDetail, // Use the fetched existing data
        ...bloodtestDetail, // Merge new/updated data
      }

      const { error } = await supabase
        .from("registration")
        .update({ bloodtest_detail: mergedBloodtestDetail })
        .eq("id", data.registrationId)

      if (error) throw error

      alert("Saved!")
      // new redirect using the internal id
      router.push(`/download-report/${registrationId}`)
    } catch (e: any) {
      console.error("Save failed:", e.message)
      alert("Save failed: " + e.message)
    }
  }

  /* ── Early returns for missing registrationId or loading ── */
  if (!registrationId)
    return (
      <CenterCard icon={User} title="Registration Not Found">
        <button onClick={() => router.push("/")} className="btn-blue">
          Back
        </button>
      </CenterCard>
    )
  if (loading)
    return (
      <CenterCard icon={Loader2} spin>
        Loading…
      </CenterCard>
    )

  const tests = watch("tests")

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-2">
      <div className="w-full max-w-3xl bg-white p-4 rounded-xl shadow relative">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-blue-100 rounded-full">
            <Droplet className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="font-bold text-lg">Blood Test Analysis</h1>
            <p className="text-sm text-gray-600">
              Patient ID: {patientDetails?.patientId} (Registration ID: {registrationId})
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)}>
          {tests.map((test, tIdx) => {
            if (test.testType?.toLowerCase() === "outsource") {
              return (
                <div key={test.testId} className="border-l-4 border-yellow-400 bg-yellow-50 mb-4 p-3 rounded">
                  <div className="flex items-center gap-2">
                    <Droplet className="w-4 h-4 text-yellow-600" />
                    <h3 className="font-semibold">{test.testName}</h3>
                  </div>
                  <p className="mt-2 text-sm text-yellow-800">This is an outsourced test. No data entry is required.</p>
                </div>
              )
            }

            const sh = test.subheadings || []
            const shNames = sh.flatMap((x) => x.parameterNames)
            const globals = test.parameters
              .map((p, i) => ({ ...p, originalIndex: i }))
              .filter((p) => !shNames.includes(p.name))

            return (
              <div key={test.testId} className="border-l-4 border-blue-600 bg-gray-50 mb-4 p-3 rounded">
                <div className="flex items-center gap-2 mb-2">
                  <Droplet className="w-4 h-4 text-blue-600" />
                  <h3 className="font-semibold">{test.testName}</h3>
                </div>

                {sh.length > 0 && globals.length > 0 && (
                  <>
                    <h4 className="font-bold text-sm mb-1">Global Parameters</h4>
                    {globals.map((p) => (
                      <ParamRow
                        key={p.originalIndex}
                        tIdx={tIdx}
                        pIdx={p.originalIndex}
                        param={p}
                        tests={tests}
                        errors={errors}
                        numericChange={numericChange}
                        textChange={textChange}
                        pickSug={pickSug}
                        calcOne={calcFormulaOnce}
                        setSuggest={setSuggest}
                        setShowSug={setShowSug}
                      />
                    ))}
                  </>
                )}

                {sh.length
                  ? sh.map((s, shIdx) => {
                      const tag = `${tIdx}-${shIdx}`
                      const list = test.parameters
                        .map((p, i) => ({ ...p, originalIndex: i }))
                        .filter((p) => s.parameterNames.includes(p.name))
                      const need100 = s.is100 === true || s.is100 === "true"
                      const last = list[list.length - 1]

                      return (
                        <div key={shIdx} className="mt-3">
                          <h4 className={`font-bold text-sm mb-1 ${warn100[tag] ? "text-red-600" : ""}`}>
                            {s.title}
                            {need100 && <span className="text-xs text-gray-500 ml-2">(must total 100%)</span>}
                          </h4>
                          {list.map((p) => {
                            const isLast = need100 && p.originalIndex === last.originalIndex
                            return (
                              <ParamRow
                                key={p.originalIndex}
                                tIdx={tIdx}
                                pIdx={p.originalIndex}
                                param={{ ...p, originalIndex: p.originalIndex }}
                                tests={tests}
                                errors={errors}
                                pickSug={pickSug}
                                numericChange={numericChange}
                                textChange={textChange}
                                calcOne={calcFormulaOnce}
                                isLastOf100={isLast}
                                fillRemaining={() => fillRemaining(tIdx, s, p.originalIndex)}
                                setSuggest={setSuggest}
                                setShowSug={setShowSug}
                              />
                            )
                          })}
                        </div>
                      )
                    })
                  : test.parameters.map((p, pIdx) => (
                      <ParamRow
                        key={pIdx}
                        tIdx={tIdx}
                        pIdx={pIdx}
                        param={{ ...p, originalIndex: pIdx }}
                        tests={tests}
                        errors={errors}
                        numericChange={numericChange}
                        textChange={textChange}
                        calcOne={calcFormulaOnce}
                        setSuggest={setSuggest}
                        setShowSug={setShowSug}
                        pickSug={pickSug}
                      />
                    ))}
              </div>
            )
          })}

          <div className="border-t pt-3 mt-4">
            <button disabled={isSubmitting} className="btn-blue w-full flex gap-2 justify-center">
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin w-5 h-5" />
                  Saving…
                </>
              ) : (
                <>
                  <CheckCircle className="w-5 h-5" />
                  Save
                </>
              )}
            </button>
          </div>
        </form>

        {showSug && suggest.length > 0 && (
          <div
            className="fixed z-50 bg-white border rounded shadow max-h-40 overflow-auto py-1"
            style={{
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: `${showSug.width}px`,
              maxWidth: "90vw",
              maxHeight: "80vh",
            }}
          >
            {suggest.map((s, i) => (
              <div
                key={i}
                className="px-2 py-1 hover:bg-gray-100 cursor-pointer text-sm"
                onMouseDown={(e) => {
                  e.preventDefault()
                  pickSug(s, showSug.t, showSug.p)
                }}
              >
                {s}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─────────────────── ParamRow Component ─────────────────── */
interface RowProps {
  tIdx: number
  pIdx: number
  param: IndexedParam
  tests: TestValueEntry[]
  errors: any
  numericChange: (v: string, t: number, p: number, sp?: number) => void
  textChange: (txt: string, t: number, p: number, rect: DOMRect) => void
  calcOne: (t: number, p: number) => void
  isLastOf100?: boolean
  fillRemaining?: () => void
  setSuggest: (s: string[]) => void
  setShowSug: (p: SuggestPos | null) => void
  pickSug: (val: string, t: number, p: number) => void
}

const ParamRow: React.FC<RowProps> = ({
  tIdx,
  pIdx,
  param,
  tests,
  errors,
  numericChange,
  textChange,
  calcOne,
  isLastOf100,
  fillRemaining,
  setSuggest,
  setShowSug,
  pickSug,
}) => {
  const currentParam = tests[tIdx].parameters[pIdx]
  const value = currentParam.value
  const numValue = Number.parseFloat(value as string)
  const parsedRange = parseRange(currentParam.range)

  let isOutOfRange = false
  if (!isNaN(numValue)) {
    const { min, max } = parsedRange
    if (min !== undefined && max !== undefined) {
      isOutOfRange = numValue < min || numValue > max
    } else if (min !== undefined) {
      isOutOfRange = numValue < min
    } else if (max !== undefined) {
      isOutOfRange = numValue > max
    }
  }

  const common = {
    className: `input w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm ${
      isOutOfRange ? "bg-red-100 border-red-300" : ""
    }`,
    placeholder: param.valueType === "number" ? "Value or >10 / <10" : "Text",
  }

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    const rect = e.target.getBoundingClientRect()
    textChange(e.target.value, tIdx, pIdx, rect)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rect = e.target.getBoundingClientRect()
    textChange(e.target.value, tIdx, pIdx, rect)
  }

  const handleBlur = () => {
    setTimeout(() => {
      setSuggest([])
      setShowSug(null)
    }, 50)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      const form = e.currentTarget.form
      if (!form) return
      const inputs = Array.from(form.elements).filter((el): el is HTMLInputElement => el.tagName === "INPUT")
      const idx = inputs.indexOf(e.currentTarget)
      const next = inputs[idx + 1]
      if (next) next.focus()
    }
  }

  return (
    <div className="pl-2 mb-1">
      <div className="flex items-center text-sm border rounded px-2 py-1">
        <div className="flex-1 flex items-center">
          <span className="font-medium text-gray-700">
            {param.name}
            {param.unit && <span className="ml-1 text-xs text-gray-500">({param.unit})</span>}
          </span>
          {param.formula && param.valueType === "number" && (
            <button
              type="button"
              onClick={() => calcOne(tIdx, pIdx)}
              className="ml-2 text-blue-600 hover:text-blue-800"
            >
              <Calculator className="w-3 h-3" />
            </button>
          )}
          {isLastOf100 && (
            <button
              type="button"
              onClick={fillRemaining}
              className="ml-2 text-green-600 hover:text-green-800 text-xs border border-green-600 px-1 rounded"
            >
              Calculate
            </button>
          )}
        </div>

        {param.valueType === "number" ? (
          <div className="mx-2 w-28 relative">
            <input
              {...common}
              onKeyDown={handleKeyDown}
              type="text"
              value={String(currentParam.value ?? "")}
              onChange={(e) => numericChange(e.target.value, tIdx, pIdx)}
            />
            {errors.tests?.[tIdx]?.parameters?.[pIdx]?.value && (
              <AlertCircle className="absolute right-1 top-1.5 w-4 h-4 text-red-500" />
            )}
          </div>
        ) : (
          <div className="mx-2 w-32">
            <input
              {...common}
              type="text"
              value={String(currentParam.value ?? "")}
              onFocus={handleFocus}
              onChange={handleChange}
              onBlur={handleBlur}
            />
          </div>
        )}

        <div className="flex-1 text-right text-gray-600">
          Normal Range: <span className="font-medium text-green-600">{currentParam.range}</span>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────── CenterCard Component ─────────────────── */
const CenterCard: React.FC<{
  icon: any
  title?: string
  spin?: boolean
  children: React.ReactNode
}> = ({ icon: Icon, title, spin, children }) => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
    <div className="bg-white p-8 rounded-xl shadow text-center max-w-md">
      <Icon className={`w-12 h-12 text-blue-600 mx-auto mb-4 ${spin ? "animate-spin" : ""}`} />
      {title && <h2 className="font-bold text-xl mb-2">{title}</h2>}
      {children}
    </div>
  </div>
)

export default BloodValuesForm
