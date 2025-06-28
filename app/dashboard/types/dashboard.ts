export interface BloodTest {
  name: any
  testId: string
  testName: string
  price: number
  testType?: string
}

export interface PaymentEntry {
  amount: number
  paymentMode: string
  time: string
}

export interface PaymentHistory {
  totalAmount: number
  discount: number
  paymentHistory: PaymentEntry[]
}

export interface Registration {
  id: number
  registration_id: number
  visitType: string
  createdAt: string
  discountAmount: number
  amountPaid: number
  bloodTests: BloodTest[]
  bloodtest: Record<string, any>
  sampleCollectedAt?: string
  paymentHistory?: PaymentHistory
  hospitalName?: string
  paymentMode?: string
  patient_id: number
  name: string
  patientId: string
  age: number
  
  gender?: string
  contact?: number
  address?: string
  day_type?: string
  total_day?: number
  title?: string
  doctor_name?: string // 👈 ADD THIS LINE
  deleteRequest?: { reason: string; requestedBy: string; requestedAt: string }
  deleted?: boolean
  deletedAt?: string
  deleteRequestApproved?: boolean
  deleteRequestApprovedAt?: string
}


export interface DashboardMetrics {
  totalRegistrations: number
  todayRegistrations: number
  totalRevenue: number
  todayRevenue: number
  pendingReports: number
  completedTests: number
}
