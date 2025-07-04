"use client"

import { useEffect, useState, useMemo } from "react"
import { useForm, useFieldArray, type SubmitHandler } from "react-hook-form"
import { useParams, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { UserCircle, Phone, Calendar, Clock, Plus, X, Search, Trash2, ArrowLeft } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"

/**
 * -----------------------------
 *  Helpers and constants
 * -----------------------------
 */

const TABLE = {
  PATIENT: "patientdetial",
  REGISTRATION: "registration",
  DOCTOR: "doctorlist",
  PACKAGE: "packages",
  BLOOD: "blood_test",
} as const

function throwIfError(error: any) {
  if (error) throw error
}

function time12ToISO(date: string, time12: string) {
  const [time, mer] = time12.split(" ")
  let [hh, mm] = time.split(":").map(Number)
  if (mer === "PM" && hh < 12) hh += 12
  if (mer === "AM" && hh === 12) hh = 0
  return new Date(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`).toISOString()
}

function isoToTime12(isoString: string) {
  const date = new Date(isoString)
  const hours = date.getHours()
  const minutes = date.getMinutes()
  const ampm = hours >= 12 ? "PM" : "AM"
  const displayHours = hours % 12 || 12
  return `${String(displayHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${ampm}`
}

function isoToDate(isoString: string) {
  return new Date(isoString).toISOString().slice(0, 10)
}

/**
 * -----------------------------
 *  Types
 * -----------------------------
 */

interface BloodTestRow {
  id: number
  test_name: string
  price: number
  outsource: boolean
}

interface BloodTestSelection {
  testId: number
  testName: string
  price: number
  testType: "inhospital" | "outsource"
}

interface PaymentEntry {
  amount: number
  paymentMode: "online" | "cash"
  time: string
}

interface PaymentHistory {
  totalAmount: number
  discount: number
  paymentHistory: PaymentEntry[]
}

interface IFormInput {
  hospitalName: string
  visitType: "opd" | "ipd"
  title: string
  name: string
  contact: string
  age: number
  dayType: "year" | "month" | "day"
  gender: string
  address?: string
  email?: string
  doctorName: string
  doctorId: number | null
  bloodTests: BloodTestSelection[]
  discountAmount: number
  paymentEntries: PaymentEntry[]
  patientId?: string
  registrationDate: string
  registrationTime: string
  tpa: boolean // true = TPA, false = Normal
}

interface PatientSuggestion {
  id: number
  name: string
  number: number
  patient_id: string
  title?: string
  age: number
  day_type: "year" | "month" | "day"
  gender: string
}

/**
 * -----------------------------
 *  Component
 * -----------------------------
 */

export default function EditPatientPage() {
  const params = useParams()
  const router = useRouter()
  const registrationId = params.registrationId as string

  /** default date + time */
  const initialDate = useMemo(() => new Date(), [])
  const defaultDate = initialDate.toISOString().slice(0, 10)
  const defaultTime = useMemo(() => {
    const h12 = initialDate.getHours() % 12 || 12
    const mer = initialDate.getHours() >= 12 ? "PM" : "AM"
    return `${String(h12).padStart(2, "0")}:${String(initialDate.getMinutes()).padStart(2, "0")} ${mer}`
  }, [initialDate])

  /** ---------------- form ---------------- */
  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<IFormInput>({
    defaultValues: {
      hospitalName: "MEDFORD HOSPITAL",
      visitType: "opd",
      title: "",
      name: "",
      contact: "",
      dayType: "year",
      gender: "",
      address: "",
      email: "",
      doctorName: "",
      doctorId: null,
      bloodTests: [],
      patientId: "",
      registrationDate: defaultDate,
      registrationTime: defaultTime,
      discountAmount: 0,
      paymentEntries: [],
      tpa: false, // Default to Normal
    },
  })

  /** local state */
  const [doctorList, setDoctorList] = useState<{ id: number; doctor_name: string }[]>([])
  const [bloodRows, setBloodRows] = useState<BloodTestRow[]>([])
  const [patientHints, setPatientHints] = useState<PatientSuggestion[]>([])
  const [showPatientHints, setShowPatientHints] = useState(false)
  const [showDoctorHints, setShowDoctorHints] = useState(false)
  const [searchText, setSearchText] = useState("")
  const [selectedTestId, setSelectedTestId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [patientDbId, setPatientDbId] = useState<number | null>(null)

  /** field arrays */
  const {
    fields: bloodTestFields,
    append: appendBloodTest,
    remove: removeBloodTest,
    replace: replaceBloodTests,
  } = useFieldArray({
    control,
    name: "bloodTests",
  })

  const {
    fields: paymentFields,
    append: appendPayment,
    remove: removePayment,
    replace: replacePayments,
  } = useFieldArray({
    control,
    name: "paymentEntries",
  })

  /** fetch existing data */
  useEffect(() => {
    if (!registrationId) return

    const fetchData = async () => {
      try {
        setLoading(true)
        setError(null)

        // Fetch registration with patient details
        const { data: registrationData, error: regError } = await supabase
          .from(TABLE.REGISTRATION)
          .select(
            `
            *,
            patientdetial (
              id, name, number, address, age, day_type, gender, patient_id, total_day, title
            )
          `,
          )
          .eq("id", registrationId)
          .single()

        if (regError) throw regError
        if (!registrationData) throw new Error("Registration not found")

        const patient = registrationData.patientdetial as any
        if (!patient) throw new Error("Patient details not found")

        // Parse payment history
        let paymentEntries: PaymentEntry[] = []
        let discountAmount = 0

        if (registrationData.amount_paid_history) {
          const paymentHistory = registrationData.amount_paid_history as PaymentHistory
          paymentEntries = paymentHistory.paymentHistory || []
          discountAmount = paymentHistory.discount || 0
        }

        // Parse blood tests
        let bloodTests: BloodTestSelection[] = []
        if (registrationData.bloodtest_data) {
          bloodTests = Array.isArray(registrationData.bloodtest_data) ? registrationData.bloodtest_data : []
        }

        // Set form values
        const formData: IFormInput = {
          hospitalName: registrationData.hospital_name || "MEDFORD HOSPITAL",
          visitType: registrationData.visit_type || "opd",
          title: patient.title || "",
          name: patient.name || "",
          contact: patient.number?.toString() || "",
          age: patient.age || 0,
          dayType: patient.day_type || "year",
          gender: patient.gender || "",
          address: patient.address || "",
          email: "",
          doctorName: registrationData.doctor_name || "",
          bloodTests: bloodTests,
          discountAmount: discountAmount,
          paymentEntries: paymentEntries,
          patientId: patient.patient_id || "",
          registrationDate: registrationData.registration_time
            ? isoToDate(registrationData.registration_time)
            : defaultDate,
          registrationTime: registrationData.registration_time
            ? isoToTime12(registrationData.registration_time)
            : defaultTime,
          tpa: registrationData.tpa ?? false,
          doctorId: null
        }

        reset(formData)
        replaceBloodTests(bloodTests)
        replacePayments(paymentEntries)
        setPatientDbId(patient.id)
      } catch (err: any) {
        console.error("Error fetching patient data:", err)
        setError(err.message || "Failed to load patient data")
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [registrationId, reset, replaceBloodTests, replacePayments, defaultDate, defaultTime])

  /** fetch look‑ups */
  useEffect(() => {
    ;(async () => {
      const { data, error } = await supabase.from(TABLE.DOCTOR).select("id, doctor_name").order("doctor_name")
      throwIfError(error)
      setDoctorList(data ?? [])
    })()
    ;(async () => {
      const { data, error } = await supabase
        .from(TABLE.BLOOD)
        .select("id, test_name, price, outsource")
        .order("test_name")
      throwIfError(error)
      setBloodRows(data ?? [])
    })()
  }, [])

  /** auto‑select gender by title */
  const titleValue = watch("title")
  useEffect(() => {
    const male = new Set(["MR", "MAST", "BABA"])
    const female = new Set(["MS", "MISS", "MRS", "BABY", "SMT"])
    const none = new Set(["BABY OF", "DR", "", "."])
    if (male.has(titleValue)) setValue("gender", "Male")
    else if (female.has(titleValue)) setValue("gender", "Female")
    else if (none.has(titleValue)) setValue("gender", "")
  }, [titleValue, setValue])

  /** patient autocomplete */
  const watchName = watch("name")
  useEffect(() => {
    if (!watchName || watchName.trim().length < 2) {
      setPatientHints([])
      return
    }
    const timer = setTimeout(async () => {
      const { data, error } = await supabase
        .from(TABLE.PATIENT)
        .select("id, name, number, patient_id, title, age, day_type, gender")
        .ilike("name", `${watchName.trim()}%`)
        .limit(10)
      throwIfError(error)
      setPatientHints(data ?? [])
    }, 300)
    return () => clearTimeout(timer)
  }, [watchName])

  /** derived totals */
  const bloodTests = watch("bloodTests")
  const discountAmount = watch("discountAmount") || 0
  const paymentEntries = watch("paymentEntries") || []
  const totalAmount = bloodTests.reduce((s, t) => s + (t.price || 0), 0)
  const totalPaid = paymentEntries.reduce((s, p) => s + (p.amount || 0), 0)
  const remainingAmount = totalAmount - discountAmount - totalPaid

  const unselectedTests = useMemo(
    () => bloodRows.filter((t) => !bloodTests.some((bt) => bt.testId === t.id)),
    [bloodRows, bloodTests],
  )

  /** handlers */
  function handlePatientSelect(p: PatientSuggestion) {
    setValue("name", p.name)
    setValue("contact", p.number.toString())
    setValue("age", p.age)
    setValue("dayType", p.day_type)
    setValue("gender", p.gender)
    setValue("title", p.title || "")
    setValue("patientId", p.patient_id)
    setShowPatientHints(false)
  }

  function addTestById(id: number) {
    const t = bloodRows.find((x) => x.id === id)
    if (!t) return
    appendBloodTest({
      testId: t.id,
      testName: t.test_name,
      price: t.price,
      testType: t.outsource ? "outsource" : "inhospital",
    })
    setSelectedTestId(null)
    setSearchText("")
  }

  function addAllTests() {
    unselectedTests.forEach((t) => addTestById(t.id))
  }

  function removeAllTests() {
    for (let i = bloodTestFields.length - 1; i >= 0; i--) removeBloodTest(i)
  }

  function addPaymentEntry() {
    const currentTime = time12ToISO(watch("registrationDate"), watch("registrationTime"))
    appendPayment({
      amount: 0,
      paymentMode: "online",
      time: currentTime,
    })
  }

  /** submit */
  const onSubmit: SubmitHandler<IFormInput> = async (data) => {
    if (data.bloodTests.length === 0) {
      alert("Please add at least one blood test before submitting.")
      return
    }
    if (!patientDbId) {
      alert("Patient ID not found. Cannot update.")
      return
    }

    try {
      const mult = data.dayType === "year" ? 360 : data.dayType === "month" ? 30 : 1
      const totalDay = data.age * mult

      /* UPDATE PATIENT ROW */
      const { error: patientErr } = await supabase
        .from(TABLE.PATIENT)
        .update({
          name: data.name.toUpperCase(),
          number: Number(data.contact),
          address: data.address || "",
          age: data.age,
          day_type: data.dayType,
          gender: data.gender,
          patient_id: data.patientId,
          total_day: totalDay,
          title: data.title,
        })
        .eq("id", patientDbId)

      throwIfError(patientErr)

      /* UPDATE REGISTRATION ROW */
      const isoTime = time12ToISO(data.registrationDate, data.registrationTime)

      // Create the global payment structure
      const paymentHistoryData: PaymentHistory = {
        totalAmount: totalAmount,
        discount: discountAmount,
        paymentHistory: data.paymentEntries.length > 0 ? data.paymentEntries : [],
      }

      // Calculate total amount paid for legacy fields
      const totalAmountPaid = data.paymentEntries.reduce((sum, entry) => sum + entry.amount, 0)

      const { error: regErr } = await supabase
        .from(TABLE.REGISTRATION)
        .update({
          amount_paid: totalAmountPaid,
          visit_type: data.visitType,
          registration_time: isoTime,
          samplecollected_time: isoTime,
          discount_amount: discountAmount,
          hospital_name: data.hospitalName,
          payment_mode: data.paymentEntries.length > 0 ? data.paymentEntries[0].paymentMode : "online",
          bloodtest_data: data.bloodTests,
          amount_paid_history: paymentHistoryData,
          doctor_name: data.doctorName,
          tpa: data.tpa,
        })
        .eq("id", registrationId)

      throwIfError(regErr)

      // WhatsApp message logic (copied from patient-entry)
      const patientContact = data.contact
      const patientName = data.name
      const registrationDate = data.registrationDate
      const registrationTime = data.registrationTime
      const doctorName = data.doctorName
      const totalAmountFormatted = totalAmount.toFixed(2)
      const totalPaidFormatted = totalPaid.toFixed(2)
      const remainingAmountFormatted = remainingAmount.toFixed(2)
      const bloodTestNames = data.bloodTests.map((test) => test.testName).join(", ") || "No blood tests booked."
      const whatsappMessage = `Dear *${patientName}*,\n\nWe have received your request for: ${registrationDate}* at *${registrationTime}* \n\n*Patient ID*: ${data.patientId}\n*Registration ID*: ${registrationId}\n*Tests Booked*: ${bloodTestNames}\n\n*Summary*:\n*Total Amount*: ₹${totalAmountFormatted}\n*Amount Paid*: ₹${totalPaidFormatted}\n*Remaining Balance*: ₹${remainingAmountFormatted}\n\nThank you for choosing us!`
      const whatsappPayload = {
        token: "99583991573",
        number: `91${patientContact}`,
        message: whatsappMessage,
      }
      try {
        const whatsappResponse = await fetch("https://wa.medblisss.com/send-text", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(whatsappPayload),
        })
        const whatsappResult = await whatsappResponse.json()
        if (whatsappResponse.ok) {
          console.log("WhatsApp message sent successfully:", whatsappResult)
        } else {
          console.error("Failed to send WhatsApp message:", whatsappResult)
        }
      } catch (whatsappError) {
        console.error("Error sending WhatsApp message:", whatsappError)
      }

      alert("Patient updated successfully ✅")
      router.back()
    } catch (err: any) {
      console.error(err)
      alert(err.message ?? "Unexpected error – check console")
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex h-screen bg-gray-50">
        
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-indigo-600 mx-auto"></div>
            <p className="mt-4 text-lg text-gray-600">Loading patient data...</p>
          </div>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="flex h-screen bg-gray-50">
      
        <div className="flex-1 flex items-center justify-center">
          <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
            <div className="text-red-500 mb-4">
              <svg className="h-16 w-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Error Loading Data</h2>
            <p className="text-gray-600 mb-6">{error}</p>
            <Button onClick={() => router.back()} className="mr-2">
              Go Back
            </Button>
            <Button onClick={() => window.location.reload()} variant="outline">
              Try Again
            </Button>
          </div>
        </div>
      </div>
    )
  }

  /** ------------------------------
   *  JSX
   * ------------------------------ */

  return (
    <div className="flex h-screen bg-gray-50">
      
      <div className="flex-1 overflow-auto">
        <Card className="h-full rounded-none">
          <CardContent className="p-6 h-full">
            <form onSubmit={handleSubmit(onSubmit)} className="h-full">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center">
                  <Button type="button" variant="ghost" size="sm" onClick={() => router.back()} className="mr-3">
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <UserCircle className="h-6 w-6 text-gray-600 mr-3" />
                  <h2 className="text-2xl font-bold text-gray-800">Edit Patient Details</h2>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="flex items-center text-sm">
                    <Calendar className="h-4 w-4 text-gray-500 mr-2" />
                    <input type="date" {...register("registrationDate")} className="p-2 border rounded text-sm w-40" />
                  </div>
                  <div className="flex items-center text-sm">
                    <Clock className="h-4 w-4 text-gray-500 mr-2" />
                    <input
                      type="text"
                      {...register("registrationTime")}
                      className="p-2 border rounded text-sm w-32"
                      placeholder="12:00 PM"
                    />
                  </div>
                </div>
              </div>

              {/* Patient Information */}
              <div className="space-y-6">
                <div className="bg-white p-4 rounded-lg border">
                  <h3 className="text-lg font-semibold text-gray-700 mb-4">Patient Information</h3>
                  <div className="grid grid-cols-12 gap-4 mb-4">
                    {/* title */}
                    <div className="col-span-2">
                      <Label className="text-sm">Title</Label>
                      <Select value={watch("title")} onValueChange={(v) => setValue("title", v)}>
                        <SelectTrigger className="h-10">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          {[".", "MR", "MRS", "MAST", "BABA", "MISS", "MS", "BABY", "SMT", "BABY OF", "DR"].map((t) => (
                            <SelectItem key={t} value={t}>
                              {t === "." ? "NoTitle" : t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* name + autocomplete */}
                    <div className="col-span-6 relative">
                      <Label className="text-sm">Full Name</Label>
                      <div className="relative">
                        <Input
                          {...register("name", {
                            required: "Name is required",
                            onChange: (e) => {
                              setShowPatientHints(true)
                              setValue("name", e.target.value.toUpperCase())
                            },
                          })}
                          className="h-10 pl-10"
                          placeholder="Type at least 2 letters..."
                          onFocus={() => setShowPatientHints(true)}
                        />
                        <UserCircle className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
                      </div>
                      {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
                      {showPatientHints && patientHints.length > 0 && (
                        <ul className="absolute z-10 w-full bg-white border border-gray-300 mt-1 rounded-md max-h-40 overflow-y-auto text-sm shadow-lg">
                          {patientHints.map((p) => (
                            <li
                              key={p.id}
                              className="px-3 py-2 hover:bg-gray-100 cursor-pointer"
                              onClick={() => handlePatientSelect(p)}
                            >
                              {p.name} – {p.number} ({p.age}
                              {p.day_type.charAt(0).toUpperCase()})
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* phone */}
                    <div className="col-span-4">
                      <Label className="text-sm">Contact Number</Label>
                      <div className="relative">
                        <Input
                          {...register("contact", {
                            required: "Phone number is required",
                            pattern: { value: /^[0-9]{10}$/, message: "Phone number must be 10 digits" },
                          })}
                          className="h-10 pl-10"
                          placeholder="Enter 10-digit mobile number"
                        />
                        <Phone className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
                      </div>
                      {errors.contact && <p className="text-red-500 text-xs mt-1">{errors.contact.message}</p>}
                    </div>
                  </div>

                  {/* age row */}
                  <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-2">
                      <Label className="text-sm">Age</Label>
                      <Input
                        type="number"
                        {...register("age", {
                          required: "Age is required",
                          min: { value: 1, message: "Age must be positive" },
                        })}
                        className="h-10"
                      />
                      {errors.age && <p className="text-red-500 text-xs mt-1">{errors.age.message}</p>}
                    </div>

                    <div className="col-span-2">
                      <Label className="text-sm">Age Unit</Label>
                      <Select value={watch("dayType")} onValueChange={(v) => setValue("dayType", v as any)}>
                        <SelectTrigger className="h-10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="year">Year</SelectItem>
                          <SelectItem value="month">Month</SelectItem>
                          <SelectItem value="day">Day</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="col-span-3">
                      <Label className="text-sm">Gender</Label>
                      <Select value={watch("gender")} onValueChange={(v) => setValue("gender", v)}>
                        <SelectTrigger className="h-10">
                          <SelectValue placeholder="Select gender" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Male">Male</SelectItem>
                          <SelectItem value="Female">Female</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="col-span-3">
                      <Label className="text-sm">Hospital</Label>
                      <Select value={watch("hospitalName")} onValueChange={(v) => setValue("hospitalName", v)}>
                        <SelectTrigger className="h-10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MEDFORD HOSPITAL">MEDFORD HOSPITAL</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="col-span-2">
                      <Label className="text-sm">Visit Type</Label>
                      <Select value={watch("visitType")} onValueChange={(v) => setValue("visitType", v as any)}>
                        <SelectTrigger className="h-10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="opd">OPD</SelectItem>
                          <SelectItem value="ipd">IPD</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* address / doctor */}
                <div className="bg-white p-4 rounded-lg border">
                  <h3 className="text-lg font-semibold text-gray-700 mb-4">Address & Doctor</h3>
                  <div className="grid grid-cols-12 gap-4 items-end">
                    <div className="col-span-5">
                      <Label className="text-sm">Address</Label>
                      <Textarea
                        {...register("address")}
                        className="min-h-[80px] resize-none"
                        placeholder="123 Main St, City"
                      />
                    </div>
                    <div className="col-span-5 relative">
                      <Label className="text-sm">Doctor Name</Label>
                      <Input
                        {...register("doctorName", {
                          onChange: () => setShowDoctorHints(true),
                        })}
                        className="h-10"
                      />
                      {showDoctorHints && doctorList.length > 0 && (
                        <ul className="absolute z-10 w-full bg-white border border-gray-300 mt-1 rounded-md max-h-40 overflow-y-auto text-sm shadow-lg">
                          {doctorList
                            .filter((d) => d.doctor_name.toLowerCase().startsWith(watch("doctorName").toLowerCase()))
                            .map((d) => (
                              <li
                                key={d.id}
                                className="px-3 py-2 hover:bg-gray-100 cursor-pointer"
                                onClick={() => {
                                  setValue("doctorName", d.doctor_name)
                                  setValue("doctorId", d.id)
                                  setShowDoctorHints(false)
                                }}
                              >
                                {d.doctor_name}
                              </li>
                            ))}
                        </ul>
                      )}
                    </div>
                    <div className="col-span-2 flex flex-col justify-end pb-1">
                      <Label className="text-sm mb-1">Type</Label>
                      <div className="flex gap-4">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={!watch("tpa")}
                            onCheckedChange={v => setValue("tpa", !v)}
                            id="normal-checkbox"
                          />
                          <Label htmlFor="normal-checkbox" className="text-sm cursor-pointer">Normal</Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={watch("tpa")}
                            onCheckedChange={v => setValue("tpa", !!v)}
                            id="tpa-checkbox"
                          />
                          <Label htmlFor="tpa-checkbox" className="text-sm cursor-pointer">TPA</Label>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Blood tests */}
                <div className="bg-white p-4 rounded-lg border">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-700">Blood Tests</h3>
                    <div className="flex items-center space-x-2">
                      <Button type="button" variant="outline" size="sm" onClick={addAllTests}>
                        Add All
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={removeAllTests}>
                        Remove All
                      </Button>
                      <div className="relative">
                        <Input
                          type="text"
                          placeholder="Search tests..."
                          className="h-9 w-48"
                          value={searchText}
                          onChange={(e) => {
                            setSearchText(e.target.value)
                          }}
                        />
                        <Search className="h-4 w-4 absolute right-3 top-2.5 text-gray-400" />
                        {searchText.trim() && (
                          <ul className="absolute z-10 w-full bg-white border border-gray-300 mt-1 rounded-md max-h-40 overflow-y-auto text-sm shadow-lg">
                            {unselectedTests
                              .filter((t) => t.test_name.toLowerCase().includes(searchText.toLowerCase()))
                              .map((t) => (
                                <li
                                  key={t.id}
                                  className="px-3 py-2 hover:bg-gray-100 cursor-pointer"
                                  onClick={() => addTestById(t.id)}
                                >
                                  {t.test_name} - ₹{t.price}
                                </li>
                              ))}
                          </ul>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => selectedTestId && addTestById(selectedTestId)}
                      >
                        <Plus className="h-4 w-4 mr-1" /> Add
                      </Button>
                    </div>
                  </div>

                  {/* table */}
                  <div className="border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[50%]">Test Name</TableHead>
                          <TableHead className="w-[20%]">Price (₹)</TableHead>
                          <TableHead className="w-[20%]">Type</TableHead>
                          <TableHead className="w-[10%]" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bloodTestFields.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center py-8 text-gray-500">
                              No tests selected
                            </TableCell>
                          </TableRow>
                        ) : (
                          bloodTestFields.map((field, idx) => (
                            <TableRow key={field.id}>
                              <TableCell>{watch(`bloodTests.${idx}.testName` as const)}</TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  {...register(`bloodTests.${idx}.price` as const, { valueAsNumber: true })}
                                  className="h-8 w-24"
                                />
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={watch(`bloodTests.${idx}.testType` as const)}
                                  onValueChange={(v) => setValue(`bloodTests.${idx}.testType` as const, v as any)}
                                >
                                  <SelectTrigger className="h-8">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="inhospital">InHouse</SelectItem>
                                    <SelectItem value="outsource">Outsource</SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                  onClick={() => removeBloodTest(idx)}
                                >
                                  <X className="h-4 w-4 text-red-500" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {/* Payment Details */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="bg-white p-4 rounded-lg border">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-700">Payment Details</h3>
                      <Button type="button" variant="outline" size="sm" onClick={addPaymentEntry}>
                        <Plus className="h-4 w-4 mr-1" /> Add Payment
                      </Button>
                    </div>

                    {/* Discount */}
                    <div className="mb-4">
                      <Label className="text-sm">Discount (₹)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        {...register("discountAmount", { valueAsNumber: true })}
                        placeholder="0"
                        className="h-10"
                      />
                    </div>

                    {/* Payment Entries */}
                    <div className="space-y-3">
                      {paymentFields.length === 0 ? (
                        <div className="text-center py-4 text-gray-500 text-sm">No payments added yet</div>
                      ) : (
                        paymentFields.map((field, idx) => (
                          <div key={field.id} className="border rounded-lg p-3 bg-gray-50">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium">Payment {idx + 1}</span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => removePayment(idx)}
                              >
                                <Trash2 className="h-3 w-3 text-red-500" />
                              </Button>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <Label className="text-xs">Amount (₹)</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  {...register(`paymentEntries.${idx}.amount` as const, { valueAsNumber: true })}
                                  className="h-8"
                                  placeholder="0"
                                />
                              </div>
                              <div>
                                <Label className="text-xs">Mode</Label>
                                <Select
                                  value={watch(`paymentEntries.${idx}.paymentMode` as const)}
                                  onValueChange={(v) =>
                                    setValue(`paymentEntries.${idx}.paymentMode` as const, v as any)
                                  }
                                >
                                  <SelectTrigger className="h-8">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="online">Online</SelectItem>
                                    <SelectItem value="cash">Cash</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="bg-white p-4 rounded-lg border">
                    <h3 className="text-lg font-semibold text-gray-700 mb-4">Payment Summary</h3>
                    <div className="space-y-3 mb-6">
                      <div className="flex justify-between">
                        <span>Total Amount:</span>
                        <span className="font-medium">₹{totalAmount.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Discount:</span>
                        <span className="font-medium">₹{discountAmount.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Total Paid:</span>
                        <span className="font-medium">₹{totalPaid.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between border-t pt-2">
                        <span className="font-semibold">Remaining Amount:</span>
                        <span
                          className={`font-semibold ${remainingAmount < 0 ? "text-red-600" : remainingAmount > 0 ? "text-orange-600" : "text-green-600"}`}
                        >
                          ₹{remainingAmount.toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <Button type="submit" disabled={isSubmitting} className="w-full bg-green-600 hover:bg-green-700">
                      {isSubmitting ? "Updating..." : "Update Patient Record"}
                    </Button>
                  </div>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
