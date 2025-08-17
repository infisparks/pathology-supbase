"use client"

import type React from "react"

import { useEffect, useState, useCallback } from "react"

import { useForm, type SubmitHandler, type Path } from "react-hook-form"

import { useParams, useRouter } from "next/navigation"

import { supabase } from "@/lib/supabase" // Assuming your Supabase client is configured here

import { Droplet, User, AlertCircle, CheckCircle, Loader2, Calculator, CircleUserRound } from "lucide-react" // Using Lucide React icons

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

import { Input } from "@/components/ui/input"

import { Button } from "@/components/ui/button"

import { Label } from "@/components/ui/label"

import { cn } from "@/lib/utils" // Utility to conditionally join class names

import { Badge } from "@/components/ui/badge"

import { Separator } from "@/components/ui/separator"

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

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

interface TestStructure {
  parameter: TestParameterValue[]
  sub_heading: SubHeading[]
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

const parseRangeKey = (key: string): { lower: number; upper: number } => {
  const unit = key.trim().slice(-1).toLowerCase()
  const [l, u] = key.slice(0, -1).split("-").map(Number)

  let lowerDays = l
  let upperDays = u

  switch (unit) {
    case "y":
      lowerDays = l * 365
      upperDays = u * 365
      break
    case "m":
      lowerDays = l * 30
      upperDays = u * 30
      break
    case "d":
      // Already in days, no conversion needed
      break
    default:
      // Default to days if no unit or unknown unit
      console.warn(`Unknown age unit: ${unit} in rangeKey: ${key}. Assuming days.`)
      break
  }
  return { lower: lowerDays, upper: upperDays }
}

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

// Helper to extract parameter names from a formula string

const getFormulaDependencies = (formula: string): string[] => {
  const matches = formula.match(/[a-zA-Z_][a-zA-Z0-9_]*/g)
  // Filter out common mathematical functions or keywords if necessary
  const keywords = new Set(["Math", "abs", "round", "floor", "ceil", "min", "max", "log", "pow", "sqrt"])
  return Array.from(new Set(matches?.filter((m) => !keywords.has(m)) || []))
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
    name: string
    day_type: string
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

        const { data: patientData, error: patientError } = await supabase
          .from("patientdetial")
          .select("id, age, gender, patient_id, name, day_type")
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
          name: patientData.name,
          day_type: patientData.day_type,
        })

        // Calculate age in days based on day_type
        let ageDays = patientData.age
        switch (patientData.day_type?.toLowerCase()) {
          case "year":
            ageDays *= 365
            break
          case "month":
            ageDays *= 30
            break
          case "day":
            // Already in days, no conversion needed
            break
          default:
            console.warn(
              `Unknown patient day_type: ${patientData.day_type}. Assuming years.`,
            )
            ageDays *= 365
            break
        }
        const genderKey = patientData.gender?.toLowerCase() === "male" ? "male" : "female"
        
        // Debug logging for age calculation
        console.log(`Patient age: ${patientData.age} ${patientData.day_type}, calculated age in days: ${ageDays}`)

        const tests: TestValueEntry[] = await Promise.all(
          bookedTests.map(async (bt: any) => {
            const { data: testDefData, error: testDefError } = await supabase
              .from("blood_test")
              .select("parameter, sub_heading")
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
                console.log(`Checking range ${r.rangeKey}: ${lower}-${upper} days, patient age: ${ageDays} days`)
                if (ageDays >= lower && ageDays <= upper) {
                  normal = r.rangeValue
                  console.log(`Selected range: ${r.rangeKey} with value: ${r.rangeValue}`)
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
                    console.log(`Checking subparameter range ${x.rangeKey}: ${lower}-${upper} days, patient age: ${ageDays} days`)
                    if (ageDays >= lower && ageDays <= upper) {
                      sNorm = x.rangeValue
                      console.log(`Selected subparameter range: ${x.rangeKey} with value: ${x.rangeValue}`)
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
              subheadings: subheadings,
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

  /* ══════════════ Automatic Formula recalculation ══════════════ */
  const calcFormulaOnce = useCallback(
    (tIdx: number, pIdx: number) => {
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
        const r = Function('"use strict";return (' + expr + ");")()
        if (!isNaN(r)) {
          // Format to exactly 2 decimal places
          const formatted = Number(r).toFixed(2)
          setValue(`tests.${tIdx}.parameters.${pIdx}.value`, formatted, { shouldValidate: false })
        }
      } catch (e) {
        console.error(`Error evaluating formula for ${p.name}:`, e)
      }
    },
    [setValue, watch],
  )

  useEffect(() => {
    testsWatch.forEach((test, tIdx) => {
      test.parameters.forEach((param, pIdx) => {
        if (param.formula && param.valueType === "number") {
          const dependencies = getFormulaDependencies(param.formula)
          const allDependenciesMet = dependencies.every((depName) => {
            const depParam = test.parameters.find((p) => p.name === depName)
            return depParam && !isNaN(+depParam.value)
          })
          if (allDependenciesMet) {
            calcFormulaOnce(tIdx, pIdx)
          }
        }
      })
    })
  }, [testsWatch, calcFormulaOnce])

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
      const enteredBy = fullEmail.split("@")[0] || "unknown"

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
              const strValue = String(p.value)
              if (/^[<>]/.test(strValue)) {
                obj.value = strValue
              } else if (p.valueType === "number" && p.value !== "") {
                const numValue = +p.value
                obj.value = strValue.includes(".") && strValue.endsWith("0") ? strValue : numValue
              }
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

        // Only save test data if there are actual parameters with values
        if (params.length > 0) {
          const existingReportedOn = existingBloodtestDetail[key]?.reportedOn
          const newReportedOn = existingReportedOn || now
          
          console.log(`Test ${key}:`, {
            existingReportedOn: existingReportedOn ? new Date(existingReportedOn).toLocaleString() : 'None',
            newReportedOn: new Date(newReportedOn).toLocaleString(),
            isNew: !existingReportedOn
          })
          
          bloodtestDetail[key] = {
            parameters: params,
            testId: t.testId,
            subheadings: t.subheadings || [],
            createdAt: existingBloodtestDetail[key]?.createdAt || now,
            reportedOn: newReportedOn, // Only set if not already present
            enteredBy,
          }
        }
      }

      const mergedBloodtestDetail = {
        ...existingBloodtestDetail,
        ...bloodtestDetail,
      }

      const { error } = await supabase
        .from("registration")
        .update({ bloodtest_detail: mergedBloodtestDetail })
        .eq("id", data.registrationId)
      if (error) throw error

      alert("Saved!")
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
        <Button onClick={() => router.push("/")}>Back</Button>
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
    <TooltipProvider>
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-1">
        <Card className="w-full max-w-3xl relative shadow-lg">
          <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center gap-2 pb-0.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
              <Droplet className="h-4 w-4" />
            </div>
            <div className="grid gap-0">
              <CardTitle className="text-lg font-bold text-gray-800">Blood Test Analysis</CardTitle>
              <CardDescription className="text-gray-600 text-xs">
                Comprehensive data entry for patient blood test results.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-1">
            {patientDetails && (
              <Card className="mb-2 bg-blue-50 border-blue-200 shadow-sm">
                <CardContent className="p-1.5 flex items-center gap-2">
                  <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-200 text-blue-700 text-lg font-semibold">
                    {patientDetails.name ? (
                      patientDetails.name.charAt(0).toUpperCase()
                    ) : (
                      <CircleUserRound className="h-6 w-6" />
                    )}
                  </div>
                  <div className="grid gap-0">
                    <p className="text-base font-semibold text-gray-800">{patientDetails.name}</p>
                    <div className="flex items-center gap-1.5 text-xs text-gray-600">
                      <span className="font-medium">Patient ID:</span> {patientDetails.patientId}
                      <Separator orientation="vertical" className="h-3" />
                      <span className="font-medium">Reg ID:</span> {registrationId}
                    </div>
                    <div className="flex items-center gap-1 mt-0">
                      <Badge variant="secondary" className="bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5">
                        Age: {patientDetails.age}
                      </Badge>
                      <Badge variant="secondary" className="bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5">
                        Gender: {patientDetails.gender}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col h-full">
              <div className="flex-1 overflow-y-auto space-y-1.5 pb-1">
                {tests.map((test, tIdx) => {
                  if (test.testType?.toLowerCase() === "outsource") {
                    return (
                      <Card key={test.testId} className="mb-1.5 border-l-4 border-yellow-500 bg-yellow-50 shadow-sm">
                        <CardContent className="p-2">
                          <div className="flex items-center gap-1.5 text-yellow-800">
                            <Droplet className="h-3.5 w-3.5" />
                            <h3 className="font-semibold text-sm">{test.testName}</h3>
                          </div>
                          <p className="mt-0.5 text-xs text-yellow-800">
                            This is an outsourced test. No data entry is required.
                          </p>
                        </CardContent>
                      </Card>
                    )
                  }
                  const sh = test.subheadings || []
                  const shNames = sh.flatMap((x) => x.parameterNames)
                  const globals = test.parameters
                    .map((p, i) => ({ ...p, originalIndex: i }))
                    .filter((p) => !shNames.includes(p.name))
                  return (
                    <Card key={test.testId} className="mb-1.5 border-l-4 border-blue-500 bg-card shadow-sm">
                      <CardHeader className="pb-0">
                        <div className="flex items-center gap-1.5">
                          <Droplet className="h-3.5 w-3.5 text-blue-600" />
                          <CardTitle className="text-sm text-gray-800">{test.testName}</CardTitle>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0">
                        {sh.length > 0 && globals.length > 0 && (
                          <>
                            <h4 className="mb-1 text-xs font-semibold text-gray-700">Global Parameters</h4>
                            <div className="grid gap-1">
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
                            </div>
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
                                <div key={shIdx} className="mt-2">
                                  <h4
                                    className={cn(
                                      "mb-1 text-xs font-semibold text-gray-700",
                                      warn100[tag] && "text-red-600",
                                    )}
                                  >
                                    {s.title}
                                    {need100 && (
                                      <span className="ml-1 text-2xs font-normal text-gray-500">(must total 100%)</span>
                                    )}
                                  </h4>
                                  <div className="grid gap-1">
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
                                pickSug={pickSug}
                                calcOne={calcFormulaOnce}
                                setSuggest={setSuggest}
                                setShowSug={setShowSug}
                              />
                            ))}
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
              <div className="mt-2 border-t pt-2 flex gap-1.5">
                <Button type="submit" disabled={isSubmitting} className="flex-1 py-1.5 text-base">
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <CheckCircle className="mr-1.5 h-4 w-4" />
                      Save Results
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
          {showSug && suggest.length > 0 && (
            <Card
              className="fixed z-50 max-h-32 overflow-auto p-0.5 shadow-lg"
              style={{
                top: showSug.y,
                left: showSug.x,
                width: `${showSug.width}px`,
                transform: "translateY(0)",
              }}
            >
              <CardContent className="p-0">
                {suggest.map((s, i) => (
                  <div
                    key={i}
                    className="cursor-pointer px-2 py-0.5 text-xs hover:bg-accent hover:text-accent-foreground"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      pickSug(s, showSug.t, showSug.p)
                    }}
                  >
                    {s}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </Card>
      </div>
    </TooltipProvider>
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
    <div className="flex items-center rounded-lg border bg-background px-1.5 py-0.5 text-xs shadow-sm">
      <div className="flex flex-1 items-center gap-1">
        <Label htmlFor={`param-${tIdx}-${pIdx}`} className="font-medium text-foreground text-xs">
          {param.name}
          {param.unit && <span className="ml-0.5 text-2xs text-muted-foreground">({param.unit})</span>}
        </Label>
        {param.formula && param.valueType === "number" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                onClick={() => calcOne(tIdx, pIdx)}
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-blue-600 hover:bg-blue-50 hover:text-blue-800"
                aria-label="Calculate formula"
              >
                <Calculator className="h-2.5 w-2.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Calculate value using formula: {param.formula}</p>
            </TooltipContent>
          </Tooltip>
        )}
        {isLastOf100 && (
          <Button
            type="button"
            onClick={fillRemaining}
            variant="outline"
            size="sm"
            className="ml-1 h-5 text-2xs text-green-600 border-green-600 hover:bg-green-50 hover:text-green-800 bg-transparent"
          >
            Calculate Rem.
          </Button>
        )}
      </div>
      {param.valueType === "number" ? (
        <div className="relative ml-1.5 w-28">
          <Input
            id={`param-${tIdx}-${pIdx}`}
            type="text"
            value={String(currentParam.value ?? "")}
            onChange={(e) => numericChange(e.target.value, tIdx, pIdx)}
            onKeyDown={handleKeyDown}
            placeholder={"Value or >10 / <10"}
            className={cn("pr-6 h-6 text-xs", isOutOfRange && "border-red-500 bg-red-50 focus-visible:ring-red-500")}
          />
          {isOutOfRange && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertCircle className="absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-red-500" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Value is outside normal range: {currentParam.range}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      ) : (
        <div className="relative ml-1.5 w-32">
          <Input
            id={`param-${tIdx}-${pIdx}`}
            type="text"
            value={String(currentParam.value ?? "")}
            onFocus={handleFocus}
            onChange={handleChange}
            onBlur={handleBlur}
            placeholder={"Text"}
            className="h-6 text-xs"
          />
        </div>
      )}
      <div className="ml-1.5 flex-1 text-right text-muted-foreground text-2xs">
        Normal Range:{" "}
        <span className={cn("font-medium", isOutOfRange ? "text-red-600" : "text-green-600")}>
          {currentParam.range}
        </span>
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
  <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-3">
    <Card className="w-full max-w-md text-center shadow-lg">
      <CardContent className="p-5">
        <Icon className={cn("mx-auto mb-2 h-9 w-9 text-primary", spin && "animate-spin")} />
        {title && <CardTitle className="mb-1 text-lg text-gray-800">{title}</CardTitle>}
        {children}
      </CardContent>
    </Card>
  </div>
)

export default BloodValuesForm