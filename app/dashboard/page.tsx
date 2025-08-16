"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { supabase } from "@/lib/supabase"
import { useRouter } from "next/navigation"

import { DashboardHeader } from "./components/dashboard-header"
import { RegistrationList } from "./components/registration-list"
import { DashboardModals } from "./components/dashboard-modals"
import {
  isAllTestsComplete,
  formatLocalDateTime,
  getRank,
  downloadBill,
  downloadMultipleBills,
} from "./lib/dashboard-utils"
import type { Registration, DashboardMetrics, PaymentHistory } from "./types/dashboard"

/**
 * Convert ISO (UTC) string to local datetime-local string (for <input type="datetime-local" />)
 */
function toLocalInputValue(isoDateString?: string) {
  if (!isoDateString) return formatLocalDateTime() // fallback to now
  const date = new Date(isoDateString)
  const off = date.getTimezoneOffset()
  const local = new Date(date.getTime() - off * 60 * 1000)
  return local.toISOString().slice(0, 16)
}

/**
 * Format datetime-local string ("YYYY-MM-DDTHH:MM") or ISO to 12-hour display in local time
 */
function format12HourLocal(dateString?: string) {
  if (!dateString) return "-"
  let d =
    dateString.includes("T") && dateString.length <= 16
      ? new Date(dateString + ":00")
      : new Date(dateString)
  if (isNaN(d.getTime())) return "-"
  let hours = d.getHours()
  const minutes = d.getMinutes()
  const ampm = hours >= 12 ? "PM" : "AM"
  hours = hours % 12
  hours = hours ? hours : 12
  const minutesStr = minutes < 10 ? "0" + minutes : minutes
  const day = d.getDate().toString().padStart(2, "0")
  const month = (d.getMonth() + 1).toString().padStart(2, "0")
  const year = d.getFullYear()
  return `${day}/${month}/${year}, ${hours}:${minutesStr} ${ampm}`
}

export default function Dashboard() {
  /* --- state --- */
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalRegistrations: 0,
    todayRegistrations: 0,
    totalRevenue: 0,
    todayRevenue: 0,
    pendingReports: 0,
    completedTests: 0,
  })
  const [selectedRegistration, setSelectedRegistration] = useState<Registration | null>(null)
  const [newAmountPaid, setNewAmountPaid] = useState<string>("")
  const [paymentMode, setPaymentMode] = useState<string>("online")
  const [searchTerm, setSearchTerm] = useState<string>("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [expandedRegistrationId, setExpandedRegistrationId] = useState<number | null>(null)
  const [fakeBillRegistration, setFakeBillRegistration] = useState<Registration | null>(null)
  const [selectedRegistrations, setSelectedRegistrations] = useState<number[]>([])
  const [selectAll, setSelectAll] = useState(false)
  const [showCheckboxes, setShowCheckboxes] = useState<boolean>(false)
  const [isFiltersExpanded, setIsFiltersExpanded] = useState<boolean>(false)
  const [isFilterContentMounted, setIsFilterContentMounted] = useState<boolean>(false)

  const [isLoading, setIsLoading] = useState(true)

  const todayStr = new Date().toISOString().split("T")[0]
  const [startDate, setStartDate] = useState<string>(todayStr)
  const [endDate, setEndDate] = useState<string>(todayStr)

  const [sampleModalRegistration, setSampleModalRegistration] = useState<Registration | null>(null)
  const [sampleDateTime, setSampleDateTime] = useState<string>(formatLocalDateTime())

  const [tempDiscount, setTempDiscount] = useState<string>("")
  const [amountId, setAmountId] = useState<string>("")

  const filterContentRef = useRef<HTMLDivElement>(null)

  const [role, setRole] = useState<string>("admin")

  const [dbSearchResults, setDbSearchResults] = useState<Registration[] | null>(null)
  const [isDbSearchLoading, setIsDbSearchLoading] = useState(false)

  // Role-based redirect for x-ray users
  const router = useRouter()
  useEffect(() => {
    if (role === 'xray') {
      router.replace('/x-rayDashboard')
    }
  }, [role, router])

  // If user is x-ray role, don't render dashboard content
  if (role === 'xray') {
    return null
  }

  /* --- helpers --- */
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsFilterContentMounted(true)
    }, 500)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (sampleModalRegistration?.sampleCollectedAt) {
      setSampleDateTime(toLocalInputValue(sampleModalRegistration.sampleCollectedAt))
    } else if (sampleModalRegistration) {
      setSampleDateTime(formatLocalDateTime())
    }
  }, [sampleModalRegistration])

  // Fetch Dashboard Stats
  const fetchDashboardStats = useCallback(async () => {
    try {
      const today = new Date().toISOString().split("T")[0]
      const start = startDate && startDate.trim() ? new Date(`${startDate}T00:00:00`) : new Date(`${today}T00:00:00`)
      const end = endDate && endDate.trim() ? new Date(`${endDate}T23:59:59`) : new Date(`${today}T23:59:59`)

      // Fetch all registrations to calculate totals and pending reports accurately
      const { data: allRegistrationsData, error: allRegistrationsError } = await supabase
        .from("registration")
        .select(
          `
        id, registration_time, amount_paid, amount_paid_history, samplecollected_time, bloodtest_data, bloodtest_detail,
        patientdetial (
          id, name, patient_id, age, gender, number, address, day_type, total_day, title
        )
      `
        )
      if (allRegistrationsError) throw allRegistrationsError

      let totalRegistrationsCount = 0;
      let totalRevenue = 0;
      let pendingReportsCount = 0;
      let completedTestsCount = 0;

      if (allRegistrationsData) {
        const mappedRegistrations: Registration[] = allRegistrationsData.map((registrationRow: any) => {
          const patientDetail = registrationRow.patientdetial || {}
          return {
            id: registrationRow.id,
            registration_id: registrationRow.id,
            visitType: registrationRow.visit_type || "",
            createdAt: registrationRow.registration_time || registrationRow.created_at,
            discountAmount: registrationRow.discount_amount || 0,
            amountPaid: registrationRow.amount_paid || 0,
            doctor_name: registrationRow.doctor_name,
            bloodTests: registrationRow.bloodtest_data || [],
            bloodtest: registrationRow.bloodtest_detail || {},
            sampleCollectedAt: registrationRow.samplecollected_time,
            paymentHistory: registrationRow.amount_paid_history || null,
            hospitalName: registrationRow.hospital_name,
            patient_id: patientDetail.patient_id || "",
            name: patientDetail.name || "Unknown",
            patientId: patientDetail.patient_id || "",
            age: patientDetail.age || 0,
            gender: patientDetail.gender,
            contact: patientDetail.number,
            address: patientDetail.address,
            day_type: patientDetail.day_type,
            total_day: patientDetail.total_day,
            title: patientDetail.title,
            tpa: registrationRow.tpa === true,
          }
        });

        mappedRegistrations.forEach((reg) => {
          // Check if registration is within the date range
          const regDate = new Date(reg.createdAt)
          const isInDateRange = regDate >= start && regDate <= end

          if (isInDateRange) {
            totalRegistrationsCount++;

            let regRevenue = 0
            if (
              reg.paymentHistory &&
              typeof reg.paymentHistory === "object" &&
              "paymentHistory" in reg.paymentHistory
            ) {
              const paymentData = reg.paymentHistory as PaymentHistory
              regRevenue = paymentData.paymentHistory?.reduce((sum, payment) => sum + payment.amount, 0) || 0
            } else {
              regRevenue = reg.amountPaid || 0
            }
            totalRevenue += regRevenue;

            // Check status for completed tests and pending reports
            const sampleCollected = !!reg.sampleCollectedAt
            const complete = isAllTestsComplete(reg)

            if (sampleCollected && complete) {
              completedTestsCount++;
            } else if (sampleCollected && !complete) {
              pendingReportsCount++;
            }
          }
        })
      }

      setMetrics({
        totalRegistrations: totalRegistrationsCount,
        todayRegistrations: totalRegistrationsCount,
        totalRevenue: totalRevenue,
        todayRevenue: totalRevenue,
        pendingReports: pendingReportsCount,
        completedTests: completedTestsCount,
      })
    } catch (error: any) {
      console.error("Dashboard: Error fetching dashboard stats:", error.message)
    }
  }, [startDate, endDate])

  // Fetch Registrations (all data)
  const fetchRegistrations = useCallback(async () => {
    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .from("registration")
        .select(
          `
          *,
          tpa,
          patientdetial (
            id, name, patient_id, age, gender, number, address, day_type, total_day, title
          )
        `,
        )
        .order("registration_time", { ascending: false })

      if (error) {
        console.error("Dashboard: Supabase fetch registrations error:", error)
        throw error
      }

      const mappedData: Registration[] = (data || []).map((registrationRow: any) => {
        const patientDetail = registrationRow.patientdetial || {}

        return {
          id: registrationRow.id,
          registration_id: registrationRow.id,
          visitType: registrationRow.visit_type || "",
          createdAt: registrationRow.registration_time || registrationRow.created_at,
          discountAmount: registrationRow.discount_amount || 0,
          amountPaid: registrationRow.amount_paid || 0,
          doctor_name: registrationRow.doctor_name,
          bloodTests: registrationRow.bloodtest_data || [],
          bloodtest: registrationRow.bloodtest_detail || {},
          sampleCollectedAt: registrationRow.samplecollected_time,
          paymentHistory: registrationRow.amount_paid_history || null,
          hospitalName: registrationRow.hospital_name,
          patient_id: patientDetail.patient_id || "", // Ensure patient_id from patientdetial is used
          name: patientDetail.name || "Unknown",
          patientId: patientDetail.patient_id || "",
          age: patientDetail.age || 0,
          gender: patientDetail.gender,
          contact: patientDetail.number,
          address: patientDetail.address,
          day_type: patientDetail.day_type,
          total_day: patientDetail.total_day,
          title: patientDetail.title,
          tpa: registrationRow.tpa === true,
        }
      })

      const sortedRegistrations = mappedData.sort((a, b) => {
        const rankDiff = getRank(a) - getRank(b)
        return rankDiff !== 0 ? rankDiff : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      })

      setRegistrations(sortedRegistrations)
    } catch (error: any) {
      console.error("Dashboard: Error fetching registrations:", error.message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Realtime Subscriptions
  useEffect(() => {
    const registrationChannel = supabase
      .channel("registration_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "registration" }, (payload) => {
        fetchRegistrations()
        fetchDashboardStats()
      })
      .subscribe()

    const patientDetialChannel = supabase
      .channel("patient_detial_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "patientdetial" }, (payload) => {
        fetchRegistrations()
        fetchDashboardStats()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(registrationChannel)
      supabase.removeChannel(patientDetialChannel)
    }
  }, [fetchRegistrations, fetchDashboardStats])

  // Initial load
  useEffect(() => {
    fetchRegistrations()
    fetchDashboardStats()
  }, [fetchRegistrations, fetchDashboardStats])

  // Update dashboard stats when date filters change
  useEffect(() => {
    fetchDashboardStats()
  }, [startDate, endDate])

  // DB search effect for long search terms
  useEffect(() => {
    const term = searchTerm.trim()
    if (term.length > 8) {
      setIsDbSearchLoading(true)
      // Query Supabase for name or number match (case-insensitive)
      supabase
        .from("registration")
        .select(
          `*,
          tpa,
          patientdetial (
            id, name, patient_id, age, gender, number, address, day_type, total_day, title
          )`
        )
        .or(`patientdetial.name.ilike.%${term}%,patientdetial.number.ilike.%${term}%`)
        .order("registration_time", { ascending: false })
        .then(({ data, error }) => {
          if (error) {
            setDbSearchResults([])
            setIsDbSearchLoading(false)
            return
          }
          const mappedData: Registration[] = (data || []).map((registrationRow: any) => {
            const patientDetail = registrationRow.patientdetial || {}
            return {
              id: registrationRow.id,
              registration_id: registrationRow.id,
              visitType: registrationRow.visit_type || "",
              createdAt: registrationRow.registration_time || registrationRow.created_at,
              discountAmount: registrationRow.discount_amount || 0,
              amountPaid: registrationRow.amount_paid || 0,
              doctor_name: registrationRow.doctor_name,
              bloodTests: registrationRow.bloodtest_data || [],
              bloodtest: registrationRow.bloodtest_detail || {},
              sampleCollectedAt: registrationRow.samplecollected_time,
              paymentHistory: registrationRow.amount_paid_history || null,
              hospitalName: registrationRow.hospital_name,
              patient_id: patientDetail.patient_id || "", // Ensure patient_id from patientdetial is used
              name: patientDetail.name || "Unknown",
              patientId: patientDetail.patient_id || "",
              age: patientDetail.age || 0,
              gender: patientDetail.gender,
              contact: patientDetail.number,
              address: patientDetail.address,
              day_type: patientDetail.day_type,
              total_day: patientDetail.total_day,
              title: patientDetail.title,
              tpa: registrationRow.tpa === true,
            }
          })
          const sorted = mappedData.sort((a, b) => {
            const rankDiff = getRank(a) - getRank(b)
            return rankDiff !== 0 ? rankDiff : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          })
          setDbSearchResults(sorted)
          setIsDbSearchLoading(false)
        })
    } else {
      setDbSearchResults(null)
      setIsDbSearchLoading(false)
    }
  }, [searchTerm])

  /* --- filters --- */
  const filteredRegistrations = useMemo(() => {
    if (dbSearchResults !== null) return dbSearchResults
    const start = startDate ? new Date(`${startDate}T00:00:00`) : null
    const end = endDate ? new Date(`${endDate}T23:59:59`) : null

    return registrations.filter((r) => {
      const term = searchTerm.trim().toLowerCase()
      const matchesSearch =
        !term ||
        r.name.toLowerCase().includes(term) ||
        (r.contact ? r.contact.toString().includes(term) : false) ||
        r.patientId.toLowerCase().includes(term)
      if (!matchesSearch) return false

      const regDate = new Date(r.createdAt)
      if (start && regDate < start) return false
      if (end && regDate > end) return false

      const sampleCollected = !!r.sampleCollectedAt
      const complete = isAllTestsComplete(r)
      switch (statusFilter) {
        case "notCollected":
          if (sampleCollected) return false
          break
        case "sampleCollected": // This means sample collected but tests not complete (Pending)
          if (!sampleCollected || complete) return false
          break
        case "completed":
          if (!sampleCollected || !complete) return false
          break
      }

      return true
    })
  }, [registrations, searchTerm, startDate, endDate, statusFilter, role, dbSearchResults])

  /* --- actions --- */
  const handleSaveSampleDate = useCallback(async () => {
    if (!sampleModalRegistration) return
    try {
      const utc = new Date(sampleDateTime)
      const isoString = utc.toISOString()
      const { error } = await supabase
        .from("registration")
        .update({ samplecollected_time: isoString })
        .eq("id", sampleModalRegistration.id)
      if (error) throw error
      alert(`Sample time updated for ${sampleModalRegistration.name}`)
      fetchRegistrations()
    } catch (e: any) {
      console.error("Dashboard: Error saving sample time:", e.message)
      alert("Error saving sample time.")
    } finally {
      setSampleModalRegistration(null)
    }
  }, [sampleModalRegistration, sampleDateTime, fetchRegistrations])

  const handleDeleteRegistration = useCallback(
    async (r: Registration) => {
      if (!confirm(`Delete registration for ${r.name}? This will permanently remove the registration record.`)) return

      try {
        const { data: regData, error: regError } = await supabase
          .from("registration")
          .select("*")
          .eq("id", r.id)
          .maybeSingle()
        if (regError) throw regError
        if (!regData) throw new Error("Registration not found!")

        const deletedData = {
          ...regData,
          deleted: true,
          deleted_time: new Date().toISOString(),
        }

        const { error: insertError } = await supabase.from("deleted_data").insert([deletedData])
        if (insertError) throw insertError

        const { error: delRegError } = await supabase.from("registration").delete().eq("id", r.id)
        if (delRegError) throw delRegError

        setRegistrations((prev) => prev.filter((registration) => registration.id !== r.id))
        fetchDashboardStats()

        alert("Registration deleted and moved to deleted_data.")
      } catch (e: any) {
        console.error("Error deleting:", e.message)
        alert("Error deleting: " + (e.message || "Unknown error"))
      }
    },
    [fetchDashboardStats],
  )

  const handleToggleSelectAll = useCallback(() => {
    if (selectAll) {
      setSelectedRegistrations([])
    } else {
      setSelectedRegistrations(filteredRegistrations.map((r) => r.id))
    }
    setSelectAll(!selectAll)
  }, [selectAll, filteredRegistrations])

  const handleToggleSelect = useCallback((registrationId: number) => {
    setSelectedRegistrations((prev) =>
      prev.includes(registrationId) ? prev.filter((id) => id !== registrationId) : [...prev, registrationId],
    )
  }, [])

  const handleToggleFilters = useCallback(() => {
    if (!isFiltersExpanded && !isFilterContentMounted) {
      setIsFilterContentMounted(true)
      setTimeout(() => {
        setIsFiltersExpanded(true)
      }, 50)
    } else {
      setIsFiltersExpanded(!isFiltersExpanded)
    }
  }, [isFiltersExpanded, isFilterContentMounted])

  const handleDownloadBill = useCallback(() => {
    if (selectedRegistration) {
      downloadBill(selectedRegistration)
    }
  }, [selectedRegistration])

  const handleDownloadMultipleBills = useCallback(() => {
    downloadMultipleBills(selectedRegistrations, registrations)
  }, [selectedRegistrations, registrations])

  // ---------- FIXED PART ----------
  const handleUpdateAmountAndDiscount = useCallback(async () => {
    if (!selectedRegistration) return

    const additionalPayment = Number.parseFloat(newAmountPaid) || 0
    const newDiscountAmount = Number.parseFloat(tempDiscount) || 0

    try {
      let currentPaymentHistory: PaymentHistory
      if (
        selectedRegistration.paymentHistory &&
        typeof selectedRegistration.paymentHistory === "object" &&
        "totalAmount" in selectedRegistration.paymentHistory
      ) {
        currentPaymentHistory = selectedRegistration.paymentHistory as PaymentHistory
      } else {
        currentPaymentHistory = {
          totalAmount: selectedRegistration.bloodTests?.reduce((s, t) => s + t.price, 0) || 0,
          discount: selectedRegistration.discountAmount || 0,
          paymentHistory:
            selectedRegistration.amountPaid > 0
              ? [
                  {
                    amount: selectedRegistration.amountPaid,
                    paymentMode: "cash",
                    time: new Date().toISOString(),
                  },
                ]
              : [],
        }
      }

      const updatedPaymentHistory: PaymentHistory = {
        totalAmount: selectedRegistration.bloodTests?.reduce((s, t) => s + t.price, 0) || 0,
        discount: newDiscountAmount,
        paymentHistory:
          additionalPayment > 0
            ? [
                ...currentPaymentHistory.paymentHistory,
                {
                  amount: additionalPayment,
                  paymentMode: paymentMode,
                  time: new Date().toISOString(),
                  ...(amountId ? { amountId } : {}),
                },
              ]
            : currentPaymentHistory.paymentHistory,
      }

      const newTotalPaid = updatedPaymentHistory.paymentHistory.reduce(
        (sum, payment) => sum + payment.amount,
        0,
      )

      const updateData: any = {
        discount_amount: newDiscountAmount,
        amount_paid: newTotalPaid,
        amount_paid_history: updatedPaymentHistory,
      }

      const { error } = await supabase.from("registration").update(updateData).eq("id", selectedRegistration.id)
      if (error) throw error

      setSelectedRegistration({
        ...selectedRegistration,
        discountAmount: newDiscountAmount,
        amountPaid: newTotalPaid,
        paymentHistory: updatedPaymentHistory,
      })

      setNewAmountPaid("")
      setAmountId("")
      setPaymentMode("online")
      alert("Payment and discount updated successfully!")
    } catch (error: any) {
      console.error("Dashboard: Error updating payment and discount:", error.message)
      alert("Error updating payment and discount. Please try again.")
    }
  }, [selectedRegistration, newAmountPaid, tempDiscount, paymentMode, amountId])
  // ---------- END FIXED PART ----------

  // When passing to FakeBill, ensure TPA price is used if tpa is true
  const getFakeBillPatient = (reg: Registration | null) => {
    if (!reg) return null
    const tpa = reg.tpa === true
    return {
      ...reg,
      bloodTests: (reg.bloodTests || []).map((t: any) => ({
        ...t,
        price: tpa && typeof t.tpa_price === 'number' ? t.tpa_price : t.price,
      })),
      tpa,
    }
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <div className="flex-1 overflow-auto">
        <div className="p-8">
          <DashboardHeader
            metrics={metrics}
            showCheckboxes={showCheckboxes}
            setShowCheckboxes={setShowCheckboxes}
            selectedRegistrations={selectedRegistrations}
            registrations={registrations}
            handleDownloadMultipleBills={handleDownloadMultipleBills}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            startDate={startDate}
            setStartDate={setStartDate}
            endDate={endDate}
            setEndDate={setEndDate}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            isFiltersExpanded={isFiltersExpanded}
            handleToggleFilters={handleToggleFilters}
            isFilterContentMounted={isFilterContentMounted}
          />

          <RegistrationList
            filteredRegistrations={filteredRegistrations}
            isLoading={isLoading || isDbSearchLoading}
            showCheckboxes={showCheckboxes}
            selectAll={selectAll}
            handleToggleSelectAll={handleToggleSelectAll}
            selectedRegistrations={selectedRegistrations}
            handleToggleSelect={handleToggleSelect}
            expandedRegistrationId={expandedRegistrationId}
            setExpandedRegistrationId={setExpandedRegistrationId}
            setSampleModalRegistration={setSampleModalRegistration}
            setSampleDateTime={setSampleDateTime}
            setSelectedRegistration={setSelectedRegistration}
            setNewAmountPaid={setNewAmountPaid}
            setTempDiscount={setTempDiscount}
            handleDownloadBill={handleDownloadBill}
            setFakeBillRegistration={setFakeBillRegistration}
            handleDeleteRegistration={handleDeleteRegistration}
            formatLocalDateTime={formatLocalDateTime}
          />
        </div>
      </div>

      <DashboardModals
        selectedRegistration={selectedRegistration}
        setSelectedRegistration={setSelectedRegistration}
        newAmountPaid={newAmountPaid}
        setNewAmountPaid={setNewAmountPaid}
        paymentMode={paymentMode}
        setPaymentMode={setPaymentMode}
        tempDiscount={tempDiscount}
        setTempDiscount={setTempDiscount}
        handleUpdateAmountAndDiscount={handleUpdateAmountAndDiscount}
        handleDownloadBill={handleDownloadBill}
        sampleModalRegistration={sampleModalRegistration}
        setSampleModalRegistration={setSampleModalRegistration}
        sampleDateTime={sampleDateTime}
        setSampleDateTime={setSampleDateTime}
        handleSaveSampleDate={handleSaveSampleDate}
        fakeBillRegistration={getFakeBillPatient(fakeBillRegistration)}
        setFakeBillRegistration={setFakeBillRegistration}
        formatLocalDateTime={formatLocalDateTime}
        deleteRequestModalRegistration={null}
        setDeleteRequestModalRegistration={function (reg: Registration | null): void {
          throw new Error("Function not implemented.")
        }}
        deleteReason={""}
        setDeleteReason={function (reason: string): void {
          throw new Error("Function not implemented.")
        }}
        submitDeleteRequest={function (): void {
          throw new Error("Function not implemented.")
        }}
        amountId={amountId}
        setAmountId={setAmountId}
      />
    </div>
  )
}