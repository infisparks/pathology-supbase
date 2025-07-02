"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { supabase } from "@/lib/supabase"

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
  const [sampleDateTime, setSampleDateTime] = useState<string>(formatLocalDateTime)

  const [tempDiscount, setTempDiscount] = useState<string>("")

  const filterContentRef = useRef<HTMLDivElement>(null)

  const [role, setRole] = useState<string>("admin")

  /* --- helpers --- */
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsFilterContentMounted(true)
    }, 500)
    return () => clearTimeout(timer)
  }, [])

  // Fetch Dashboard Stats
  const fetchDashboardStats = useCallback(async () => {
    console.log("Dashboard: Fetching dashboard stats...")
    try {
      const today = new Date().toISOString().split("T")[0]

      const { count: totalRegistrationsCount, error: totalRegistrationsError } = await supabase
        .from("registration")
        .select("*", { count: "exact", head: true })
      if (totalRegistrationsError) throw totalRegistrationsError

      const { count: todayRegistrationsCount, error: todayRegistrationsError } = await supabase
        .from("registration")
        .select("*", { count: "exact", head: true })
        .gte("registration_time", today)
      if (todayRegistrationsError) throw todayRegistrationsError

      const { data: registrationsData, error: registrationsError } = await supabase
        .from("registration")
        .select("amount_paid, amount_paid_history, registration_time, samplecollected_time, bloodtest_data")
      if (registrationsError) throw registrationsError

      let totalRevenue = 0
      let todayRevenue = 0
      let pendingTestsCount = 0
      let completedTestsCount = 0

      if (registrationsData) {
        registrationsData.forEach((reg) => {
          let regRevenue = 0
          if (
            reg.amount_paid_history &&
            typeof reg.amount_paid_history === "object" &&
            "paymentHistory" in reg.amount_paid_history
          ) {
            const paymentData = reg.amount_paid_history as PaymentHistory
            regRevenue = paymentData.paymentHistory?.reduce((sum, payment) => sum + payment.amount, 0) || 0
          } else {
            regRevenue = reg.amount_paid || 0
          }

          totalRevenue += regRevenue
          if (reg.registration_time?.startsWith(today)) {
            todayRevenue += regRevenue
          }

          if (reg.samplecollected_time) {
            completedTestsCount++
          } else {
            pendingTestsCount++
          }
        })
      }

      setMetrics({
        totalRegistrations: totalRegistrationsCount || 0,
        todayRegistrations: todayRegistrationsCount || 0,
        totalRevenue,
        todayRevenue,
        pendingReports: pendingTestsCount,
        completedTests: completedTestsCount,
      })
      console.log("Dashboard: Metrics updated:", {
        totalRegistrations: totalRegistrationsCount,
        todayRegistrations: todayRegistrationsCount,
        totalRevenue,
        todayRevenue,
        pendingReports: pendingTestsCount,
        completedTests: completedTestsCount,
      })
    } catch (error: any) {
      console.error("Dashboard: Error fetching dashboard stats:", error.message)
    }
  }, [])

  // Fetch Registrations (all data)
  const fetchRegistrations = useCallback(async () => {
    setIsLoading(true)
    console.log("Dashboard: Fetching all registrations...")
    try {
      const { data, error } = await supabase
        .from("registration")
        .select(
          `
        *,
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

      console.log("Dashboard: Raw Supabase registration data received:", data)

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
          paymentMode: registrationRow.payment_mode,

          patient_id: registrationRow.patient_id,
          name: patientDetail.name || "Unknown",
          patientId: patientDetail.patient_id || "",
          age: patientDetail.age || 0,
          gender: patientDetail.gender,
          contact: patientDetail.number,
          address: patientDetail.address,
          day_type: patientDetail.day_type,
          total_day: patientDetail.total_day,
          title: patientDetail.title,
        }
      })

      const sortedRegistrations = mappedData.sort((a, b) => {
        const rankDiff = getRank(a) - getRank(b)
        return rankDiff !== 0 ? rankDiff : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      })

      setRegistrations(sortedRegistrations)
      console.log("Dashboard: All registrations loaded successfully. Total:", sortedRegistrations.length)
    } catch (error: any) {
      console.error("Dashboard: Error fetching registrations:", error.message)
    } finally {
      setIsLoading(false)
      console.log("Dashboard: Loading set to false.")
    }
  }, [])

  // Realtime Subscriptions
  useEffect(() => {
    console.log("Dashboard: Setting up Supabase Realtime subscriptions...")

    const registrationChannel = supabase
      .channel("registration_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "registration" }, (payload) => {
        console.log("Realtime: registration change received!", payload)
        fetchRegistrations()
        fetchDashboardStats()
      })
      .subscribe()

    const patientDetialChannel = supabase
      .channel("patient_detial_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "patientdetial" }, (payload) => {
        console.log("Realtime: patientdetial change received!", payload)
        fetchRegistrations()
        fetchDashboardStats()
      })
      .subscribe()

    return () => {
      console.log("Dashboard: Unsubscribing from Supabase Realtime channels.")
      supabase.removeChannel(registrationChannel)
      supabase.removeChannel(patientDetialChannel)
    }
  }, [fetchRegistrations, fetchDashboardStats])

  // Initial load
  useEffect(() => {
    fetchRegistrations()
    fetchDashboardStats()
  }, [fetchRegistrations, fetchDashboardStats])

  /* --- filters --- */
  const filteredRegistrations = useMemo(() => {
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
        case "sampleCollected":
          if (!sampleCollected || complete) return false
          break
        case "completed":
          if (!sampleCollected || !complete) return false
          break
      }

      return true
    })
  }, [registrations, searchTerm, startDate, endDate, statusFilter, role])

  /* --- actions --- */
  const handleSaveSampleDate = useCallback(async () => {
    if (!sampleModalRegistration) return
    console.log("Dashboard: Saving sample date for registration:", sampleModalRegistration.id)
    try {
      const { error } = await supabase
        .from("registration")
        .update({ samplecollected_time: new Date(sampleDateTime).toISOString() })
        .eq("id", sampleModalRegistration.id)
      if (error) throw error
      alert(`Sample time updated for ${sampleModalRegistration.name}`)
      console.log("Dashboard: Sample time updated successfully.")
      // Auto-refresh registrations after update
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
        // Fetch the registration data before deleting
        const { data: regData, error: regError } = await supabase
          .from("registration")
          .select("*")
          .eq("id", r.id)
          .maybeSingle()
        if (regError) throw regError
        if (!regData) throw new Error("Registration not found!")

        // Prepare data for the deleted_data table
        const deletedData = {
          ...regData,
          deleted: true, // Mark as deleted in the new table
          deleted_time: new Date().toISOString(), // Record deletion time
        }

        // Insert into deleted_data table
        const { error: insertError } = await supabase.from("deleted_data").insert([deletedData])
        if (insertError) throw insertError

        // Delete from the original registration table
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

  const handleUpdateAmountAndDiscount = useCallback(async () => {
    if (!selectedRegistration) return
    console.log("Dashboard: Updating amount and discount for registration:", selectedRegistration.id)

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
                },
              ]
            : currentPaymentHistory.paymentHistory,
      }

      const newTotalPaid = updatedPaymentHistory.paymentHistory.reduce((sum, payment) => sum + payment.amount, 0)

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
      setPaymentMode("online")
      alert("Payment and discount updated successfully!")
      console.log("Dashboard: Payment and discount updated successfully.")
    } catch (error: any) {
      console.error("Dashboard: Error updating payment and discount:", error.message)
      alert("Error updating payment and discount. Please try again.")
    }
  }, [selectedRegistration, newAmountPaid, tempDiscount, paymentMode])

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
            isLoading={isLoading}
            showCheckboxes={showCheckboxes}
            selectAll={selectAll}
            handleToggleSelectAll={handleToggleSelectAll}
            selectedRegistrations={selectedRegistrations}
            handleToggleSelect={handleToggleSelect}
            expandedRegistrationId={expandedRegistrationId}
            setExpandedRegistrationId={setExpandedRegistrationId}
            // role={role}
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
        fakeBillRegistration={fakeBillRegistration}
        setFakeBillRegistration={setFakeBillRegistration}
        formatLocalDateTime={formatLocalDateTime} deleteRequestModalRegistration={null} setDeleteRequestModalRegistration={function (reg: Registration | null): void {
          throw new Error("Function not implemented.")
        } } deleteReason={""} setDeleteReason={function (reason: string): void {
          throw new Error("Function not implemented.")
        } } submitDeleteRequest={function (): void {
          throw new Error("Function not implemented.")
        } }      />
    </div>
  )
}
