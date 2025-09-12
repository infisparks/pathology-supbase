"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { format, subDays, startOfMonth, endOfMonth, startOfDay, endOfDay, isValid } from "date-fns"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table"
import { CalendarIcon, Search, History, Loader2 } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import * as XLSX from "xlsx"

// Define types for registration data
// Update Registration type to match new paymentHistory structure
type PaymentHistoryItem = {
  amount: number
  paymentMode: string // 'cash' or 'online'
  time: string
  amountId: string
}

interface Registration {
  id: string
  created_at: string
  patient_id: string
  amount_paid: number
  discount_amount: number
  hospital_name: string
  payment_mode: string
  amount_paid_history: {
    totalAmount: number
    discount: number
    paymentHistory: PaymentHistoryItem[]
  } | null
  visit_type: string
  doctor_name: string
  name?: string // Added patient name
  contact?: string // Added patient contact number
}

type DateRangeOption = "today" | "last7days" | "thismonth" | "custom"

export default function BillingPage() {
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState<DateRangeOption>("last7days")
  const [startDate, setStartDate] = useState<Date | undefined>(subDays(new Date(), 6))
  const [endDate, setEndDate] = useState<Date | undefined>(new Date())
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedRegistration, setSelectedRegistration] = useState<Registration | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [hospitalFilterTerm, setHospitalFilterTerm] = useState<string>("all")

  // Wrap fetchRegistrations in useCallback
  const fetchRegistrations = useCallback(async () => {
    setLoading(true)
    let query = supabase.from("registration").select(
      `
      *,
      patientdetial(
        name,
        number
      )
      `
    )

    // Apply date filters
    if (startDate && endDate) {
      query = query.gte("created_at", format(startOfDay(startDate), "yyyy-MM-dd HH:mm:ss.SSSxxx"))
      query = query.lte("created_at", format(endOfDay(endDate), "yyyy-MM-dd HH:mm:ss.SSSxxx"))
    }

    // Apply search filter (Registration ID, Patient Name, or Patient Number)
    if (searchQuery) {
      query = query.or(`id.ilike.%${searchQuery}%,patientdetial.name.ilike.%${searchQuery}%,patientdetial.number.ilike.%${searchQuery}%`)
    }

    // Apply hospital filter
    if (hospitalFilterTerm !== "all") {
      query = query.eq("hospital_name", hospitalFilterTerm)
    }

    const { data, error } = await query.order("created_at", { ascending: false })

    if (error) {
      console.error("Error fetching registrations:", error)
    } else {
      const parsedData = data.map((reg: any) => ({
        ...reg,
        name: reg.patientdetial?.name || "",
        contact: reg.patientdetial?.number || "",
        amount_paid_history: reg.amount_paid_history as unknown as Registration["amount_paid_history"],
      }))
      setRegistrations(parsedData)
    }
    setLoading(false)
  }, [startDate, endDate, searchQuery, hospitalFilterTerm]) // Dependencies for useCallback

  useEffect(() => {
    fetchRegistrations()
  }, [fetchRegistrations]) // Now fetchRegistrations is a stable dependency

  // Handle date range selection
  const handleDateRangeChange = (option: DateRangeOption) => {
    setDateRange(option)
    const now = new Date()
    if (option === "today") {
      setStartDate(startOfDay(now))
      setEndDate(endOfDay(now))
    } else if (option === "last7days") {
      setStartDate(subDays(now, 6))
      setEndDate(now)
    } else if (option === "thismonth") {
      setStartDate(startOfMonth(now))
      setEndDate(endOfMonth(now))
    } else if (option === "custom") {
      // Keep current custom dates or reset if not set
      if (!startDate || !endDate) {
        setStartDate(undefined)
        setEndDate(undefined)
      }
    }
  }

  // Calculate total net billing (sum of Total Bill After Discount)
  const totalAmountAfterDiscount = useMemo(() => {
    return registrations.reduce((sum, reg) => {
      const totalBill = reg.amount_paid_history?.totalAmount || 0
      return sum + (totalBill - reg.discount_amount)
    }, 0)
  }, [registrations])

  // Add summary calculations
  const totalDiscount = useMemo(() => {
    return registrations.reduce((sum, reg) => sum + (reg.amount_paid_history?.discount || reg.discount_amount || 0), 0)
  }, [registrations])

  const totalAmount = useMemo(() => {
    return registrations.reduce((sum, reg) => sum + (reg.amount_paid_history?.totalAmount || 0), 0)
  }, [registrations])

  const totalCollected = useMemo(() => {
    return registrations.reduce((sum, reg) => {
      if (!reg.amount_paid_history?.paymentHistory) return sum
      return sum + reg.amount_paid_history.paymentHistory.reduce((s, p) => s + (p.amount || 0), 0)
    }, 0)
  }, [registrations])

  const totalCash = useMemo(() => {
    return registrations.reduce((sum, reg) => {
      if (!reg.amount_paid_history?.paymentHistory) return sum
      return sum + reg.amount_paid_history.paymentHistory.filter(p => p.paymentMode === 'cash').reduce((s, p) => s + (p.amount || 0), 0)
    }, 0)
  }, [registrations])

  const totalOnline = useMemo(() => {
    return registrations.reduce((sum, reg) => {
      if (!reg.amount_paid_history?.paymentHistory) return sum
      return sum + reg.amount_paid_history.paymentHistory.filter(p => p.paymentMode === 'online').reduce((s, p) => s + (p.amount || 0), 0)
    }, 0)
  }, [registrations])

  // FIX: Correctly calculate total remaining amount by subtracting collected amount from the total bill after discount
  const totalRemaining = useMemo(() => {
    return registrations.reduce((sum, reg) => {
      const totalBill = reg.amount_paid_history?.totalAmount || 0
      const discount = reg.amount_paid_history?.discount || reg.discount_amount || 0
      const collected = reg.amount_paid_history?.paymentHistory?.reduce((s, p) => s + (p.amount || 0), 0) || 0
      const billAfterDiscount = totalBill - discount;
      return sum + (billAfterDiscount - collected)
    }, 0)
  }, [registrations])

  const handleRowClick = (registration: Registration) => {
    setSelectedRegistration(registration)
    setIsModalOpen(true)
  }

  // Add Excel export handler
  const handleExportExcel = () => {
    // Flatten registrations for export
    const rows = registrations.flatMap((reg) => {
      const paymentHistory = reg.amount_paid_history?.paymentHistory || []
      // If no payment history, still export a row
      if (paymentHistory.length === 0) {
        return [{
          "Registration ID": reg.id,
          "Patient ID": reg.patient_id,
          "User Name": reg.name || reg.patient_id, // Use name if available, otherwise patient_id
          "User Number": reg.contact || "", // Use contact if available, otherwise empty
          "Payment Method": reg.payment_mode,
          "Payment ID": "",
          "TPA": reg.visit_type === 'TPA' ? 'Yes' : 'No',
          "Total Discount": reg.amount_paid_history?.discount || reg.discount_amount || 0,
          "Test Name": "", // Fill with test name if available
          "Hospital Name": reg.hospital_name,
          "Doctor Name": reg.doctor_name,
          "Date": reg.created_at,
        }]
      }
      // Otherwise, one row per payment
      return paymentHistory.map((p) => ({
        "Registration ID": reg.id,
        "Patient ID": reg.patient_id,
        "User Name": reg.name || reg.patient_id, // Use name if available, otherwise patient_id
        "User Number": reg.contact || "", // Use contact if available, otherwise empty
        "Payment Method": p.paymentMode,
        "Payment ID": p.amountId || "",
        "TPA": reg.visit_type === 'TPA' ? 'Yes' : 'No',
        "Total Discount": reg.amount_paid_history?.discount || reg.discount_amount || 0,
        "Test Name": "", // Fill with test name if available
        "Hospital Name": reg.hospital_name,
        "Doctor Name": reg.doctor_name,
        "Date": p.time || reg.created_at,
      }))
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Billing")
    XLSX.writeFile(wb, `billing_export_${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6 text-gray-800">Billing Dashboard</h1>

      {/* Revenue Summary */}
      {/* Replace the single summary card with a grid of summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <Card className="bg-gradient-to-r from-blue-500 to-purple-600 text-white">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Total Amount</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{totalAmount.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-r from-green-500 to-blue-600 text-white">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Total Discount</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{totalDiscount.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-r from-yellow-500 to-orange-600 text-white">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Total Cash</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{totalCash.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-r from-pink-500 to-red-600 text-white">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Total Online</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{totalOnline.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-r from-gray-500 to-gray-700 text-white">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Total Collected</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{totalCollected.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-r from-indigo-500 to-blue-900 text-white">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Total Remaining</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{totalRemaining.toLocaleString()}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Search */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="flex gap-2">
          <Button
            variant={dateRange === "today" ? "default" : "outline"}
            onClick={() => handleDateRangeChange("today")}
          >
            Today
          </Button>
          <Button
            variant={dateRange === "last7days" ? "default" : "outline"}
            onClick={() => handleDateRangeChange("last7days")}
          >
            Last 7 Days
          </Button>
          <Button
            variant={dateRange === "thismonth" ? "default" : "outline"}
            onClick={() => handleDateRangeChange("thismonth")}
          >
            This Month
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={"outline"}
                className={cn("w-[280px] justify-start text-left font-normal", !startDate && "text-muted-foreground")}
                onClick={() => handleDateRangeChange("custom")}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {startDate ? (
                  endDate ? (
                    `${format(startDate, "LLL dd, y")} - ${format(endDate, "LLL dd, y")}`
                  ) : (
                    format(startDate, "LLL dd, y")
                  )
                ) : (
                  <span>Pick a date range</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                selected={{ from: startDate, to: endDate }}
                onSelect={(range) => {
                  setStartDate(range?.from)
                  setEndDate(range?.to)
                  setDateRange("custom")
                }}
                numberOfMonths={2}
              />
            </PopoverContent>
          </Popover>
        </div>
        <div className="relative flex-grow max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
          <Input
            type="text"
            placeholder="Search by Registration ID..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select
          value={hospitalFilterTerm}
          onChange={(e) => setHospitalFilterTerm(e.target.value)}
          className="w-full md:w-auto p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
        >
          <option value="all">All Hospitals</option>
          <option value="MEDFORD HOSPITAL">MEDFORD HOSPITAL</option>
          <option value="Gautami Medford NX Hospital">Gautami Medford NX Hospital</option>
          <option value="Apex Clinic">Apex Clinic</option>
        </select>
      </div>

      {/* Add Export to Excel button above the table */}
      <div className="flex justify-end mb-4">
        <Button onClick={handleExportExcel} variant="outline">
          Export to Excel
        </Button>
      </div>

      {/* Registrations Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Registrations</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center items-center h-40">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : registrations.length === 0 ? (
            <div className="text-center text-gray-500 py-8">No registrations found for the selected criteria.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reg ID</TableHead>
                    <TableHead>Created At</TableHead>
                    <TableHead>Total Bill</TableHead>
                    <TableHead>Discount</TableHead>
                    <TableHead>Cash</TableHead>
                    <TableHead>Online</TableHead>
                    <TableHead>Total Collected</TableHead>
                    <TableHead>Remaining</TableHead>
                    <TableHead>Hospital</TableHead>
                    <TableHead>Doctor</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registrations.map((reg) => {
                    const totalBill = reg.amount_paid_history?.totalAmount || 0
                    const discount = reg.amount_paid_history?.discount || reg.discount_amount || 0
                    const paymentHistory = reg.amount_paid_history?.paymentHistory || []
                    const cash = paymentHistory.filter(p => p.paymentMode === 'cash').reduce((s, p) => s + (p.amount || 0), 0)
                    const online = paymentHistory.filter(p => p.paymentMode === 'online').reduce((s, p) => s + (p.amount || 0), 0)
                    const collected = paymentHistory.reduce((s, p) => s + (p.amount || 0), 0)
                    // FIX: Calculate remaining after subtracting discount and collected amount
                    const remaining = (totalBill - discount) - collected
                    return (
                      <TableRow
                        key={reg.id}
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => handleRowClick(reg)}
                      >
                        <TableCell className="font-medium">{reg.id}</TableCell>
                        <TableCell>{format(new Date(reg.created_at), "MMM dd, yyyy HH:mm")}</TableCell>
                        <TableCell>₹{totalBill.toLocaleString()}</TableCell>
                        <TableCell>₹{discount.toLocaleString()}</TableCell>
                        <TableCell>₹{cash.toLocaleString()}</TableCell>
                        <TableCell>₹{online.toLocaleString()}</TableCell>
                        <TableCell>₹{collected.toLocaleString()}</TableCell>
                        <TableCell>₹{remaining.toLocaleString()}</TableCell>
                        <TableCell>{reg.hospital_name}</TableCell>
                        <TableCell>{reg.doctor_name}</TableCell>
                        <TableCell>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleRowClick(reg)
                            }}
                          >
                            <History className="h-4 w-4 mr-2" /> View History
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment History Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Payment History for Registration ID: {selectedRegistration?.id}</DialogTitle>
            <DialogDescription>
              Details of payments made for Registration ID: {selectedRegistration?.id}
            </DialogDescription>
          </DialogHeader>
          {selectedRegistration && (
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <strong>Total Bill:</strong> ₹
                  {selectedRegistration.amount_paid_history?.totalAmount?.toLocaleString() || "N/A"}
                </div>
                <div>
                  <strong>Discount:</strong> ₹{selectedRegistration.discount_amount.toLocaleString()}
                </div>
                <div>
                  <strong>Total Bill After Discount:</strong> ₹
                  {(
                    (selectedRegistration.amount_paid_history?.totalAmount || 0) - selectedRegistration.discount_amount
                  ).toLocaleString()}
                </div>
                <div>
                  <strong>Collected Amount:</strong> ₹
                  {selectedRegistration.amount_paid_history?.paymentHistory?.reduce((s, p) => s + (p.amount || 0), 0).toLocaleString() || "N/A"}
                </div>
                {/* FIX: Correctly calculate remaining amount in the modal */}
                <div>
                  <strong>Remaining Amount:</strong> ₹
                  {(
                    (selectedRegistration.amount_paid_history?.totalAmount || 0) -
                    (selectedRegistration.amount_paid_history?.discount || selectedRegistration.discount_amount || 0) -
                    (selectedRegistration.amount_paid_history?.paymentHistory?.reduce((s, p) => s + (p.amount || 0), 0) || 0)
                  ).toLocaleString()}
                </div>
              </div>
              <h3 className="font-semibold mt-2">Payment Transactions:</h3>
              {selectedRegistration.amount_paid_history?.paymentHistory &&
              selectedRegistration.amount_paid_history.paymentHistory.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Mode</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedRegistration.amount_paid_history.paymentHistory.map((payment, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          {payment.time && isValid(new Date(payment.time))
                            ? format(new Date(payment.time), "MMM dd, yyyy HH:mm")
                            : "N/A"}
                        </TableCell>
                        <TableCell>₹{payment.amount.toLocaleString()}</TableCell>
                        <TableCell>{payment.paymentMode}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-gray-500">No detailed payment history available.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}