"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { format, subDays, startOfMonth, endOfMonth, startOfDay, endOfDay, isValid } from "date-fns"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table"
import { CalendarIcon, Search, DollarSign, History, Loader2 } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"

// Define types for registration data
interface Registration {
  id: string
  created_at: string
  patient_id: string // Keep patient_id in interface as it's in the DB, but won't be displayed in table
  amount_paid: number
  discount_amount: number
  hospital_name: string
  payment_mode: string
  amount_paid_history: {
    totalAmount: number
    discount: number
    paymentHistory: Array<{
      date: string
      amount: number
      mode: string
    }>
  } | null
  visit_type: string
  doctor_name: string
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

  // Wrap fetchRegistrations in useCallback
  const fetchRegistrations = useCallback(async () => {
    setLoading(true)
    let query = supabase.from("registration").select("*")

    // Apply date filters
    if (startDate && endDate) {
      query = query.gte("created_at", format(startOfDay(startDate), "yyyy-MM-dd HH:mm:ss.SSSxxx"))
      query = query.lte("created_at", format(endOfDay(endDate), "yyyy-MM-dd HH:mm:ss.SSSxxx"))
    }

    // Apply search filter (still on registration ID)
    if (searchQuery) {
      query = query.ilike("id", `%${searchQuery}%`)
    }

    const { data, error } = await query.order("created_at", { ascending: false })

    if (error) {
      console.error("Error fetching registrations:", error)
    } else {
      const parsedData = data.map((reg) => ({
        ...reg,
        amount_paid_history: reg.amount_paid_history as unknown as Registration["amount_paid_history"],
      }))
      setRegistrations(parsedData)
    }
    setLoading(false)
  }, [startDate, endDate, searchQuery]) // Dependencies for useCallback

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

  const handleRowClick = (registration: Registration) => {
    setSelectedRegistration(registration)
    setIsModalOpen(true)
  }

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6 text-gray-800">Billing Dashboard</h1>

      {/* Revenue Summary */}
      <Card className="mb-6 bg-gradient-to-r from-blue-500 to-purple-600 text-white">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Amount After Discount</CardTitle> {/* Updated title */}
          <DollarSign className="h-4 w-4 text-white" />
        </CardHeader>
        <CardContent>
          <div className="text-4xl font-bold">₹{totalAmountAfterDiscount.toLocaleString()}</div>{" "}
          {/* Display totalAmountAfterDiscount */}
          <p className="text-xs text-gray-200">+20.1% from last month</p> {/* Placeholder */}
        </CardContent>
      </Card>

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
                    <TableHead>Total Bill After Discount</TableHead>
                    <TableHead>Collected Amount</TableHead>
                    <TableHead>Remaining Amount</TableHead>
                    <TableHead>Payment Mode</TableHead>
                    <TableHead>Hospital</TableHead>
                    <TableHead>Doctor</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registrations.map((reg) => {
                    const totalBill = reg.amount_paid_history?.totalAmount || 0
                    const totalBillAfterDiscount = totalBill - reg.discount_amount
                    const remainingAmount = totalBill - reg.amount_paid

                    return (
                      <TableRow
                        key={reg.id}
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => handleRowClick(reg)}
                      >
                        <TableCell className="font-medium">{reg.id}</TableCell>
                        <TableCell>{format(new Date(reg.created_at), "MMM dd, yyyy HH:mm")}</TableCell>
                        <TableCell>₹{totalBill.toLocaleString()}</TableCell>
                        <TableCell>₹{reg.discount_amount.toLocaleString()}</TableCell>
                        <TableCell>₹{totalBillAfterDiscount.toLocaleString()}</TableCell>
                        <TableCell>₹{reg.amount_paid.toLocaleString()}</TableCell>
                        <TableCell>₹{remainingAmount.toLocaleString()}</TableCell>
                        <TableCell>{reg.payment_mode}</TableCell>
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
                  <strong>Collected Amount:</strong> ₹{selectedRegistration.amount_paid.toLocaleString()}
                </div>
                <div>
                  <strong>Remaining Amount:</strong> ₹
                  {(
                    (selectedRegistration.amount_paid_history?.totalAmount || 0) - selectedRegistration.amount_paid
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
                          {payment.date && isValid(new Date(payment.date))
                            ? format(new Date(payment.date), "MMM dd, yyyy HH:mm")
                            : "N/A"}
                        </TableCell>
                        <TableCell>₹{payment.amount.toLocaleString()}</TableCell>
                        <TableCell>{payment.mode}</TableCell>
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
