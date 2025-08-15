'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { UserPlus, FlaskConical, Stethoscope, Eye, Trash2, Search, Filter, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Helper function to format date
const formatDate = (dateString: string): string => {
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return new Date(dateString).toLocaleDateString(undefined, options);
};

interface XrayTest {
  name: string;
  amount: number;
}

// Dummy data for X-ray tests
const dummyXrays: XrayTest[] = [
  { name: 'Chest PA', amount: 500 },
  { name: 'KUB', amount: 800 },
  { name: 'Abdomen AP/LAT', amount: 1200 },
  { name: 'Pelvis AP', amount: 750 },
  { name: 'Shoulder AP', amount: 600 },
  { name: 'Knee AP/LAT', amount: 700 },
  { name: 'Ankle AP/LAT', amount: 650 },
  { name: 'Foot AP/LAT', amount: 550 },
];

// Helper function for exponential backoff retry logic
const withRetry = async <T,>(fn: () => Promise<any>, retries = 3, delay = 1000): Promise<any> => {
  try {
    return await fn();
  } catch (error) {
    if (retries > 0) {
      await new Promise(res => setTimeout(res, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
};

// Main X-ray page component
export default function XrayPage() {
  const [formData, setFormData] = useState({
    name: '',
    phoneNumber: '',
    age: '',
    ageUnit: 'Years',
    hospitalName: 'MEDFORD HOSPITAL',
    billNumber: '',
    xrayTests: [{ examination: '', amount: 0, views: 1, xrayVia: 'Price' }],
    totalAmount: 0,
    discount: 0,
    paymentMethod: 'Cash',
    cashType: 'Cash',
    onlineType: 'Credit card',
  });

  const [tableData, setTableData] = useState<any[]>([]);
  const [filteredData, setFilteredData] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterOption, setFilterOption] = useState('All');
  const [dateRange, setDateRange] = useState('Today');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalData, setModalData] = useState<any | null>(null);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');

  // Fetch initial data from Supabase
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    const result = await withRetry(async () =>
      await supabase.from('x-raydetail').select('*').order('created_at', { ascending: false })
    );
    if (result.error) {
      console.error('Error fetching data:', result.error);
      setMessage('Failed to fetch data. Please try again.');
      setMessageType('error');
    } else {
      setTableData(result.data || []);
      setFilteredData(result.data || []);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle search and filter logic
  useEffect(() => {
    const lowercasedSearchTerm = searchTerm.toLowerCase();
    let updatedData = tableData.filter(item => {
      const nameMatch = item.name?.toLowerCase().includes(lowercasedSearchTerm);
      const contactMatch = item.number?.includes(lowercasedSearchTerm);
      const billMatch = String(item.bill_number)?.includes(lowercasedSearchTerm);
      return nameMatch || contactMatch || billMatch;
    });

    if (filterOption !== 'All') {
      updatedData = updatedData.filter(item => {
        try {
          const xrayDetails = typeof item['x-ray_detail'] === 'string' ? JSON.parse(item['x-ray_detail']) : item['x-ray_detail'];
          return xrayDetails?.some((xray: { Xray_Via: string }) => xray.Xray_Via === filterOption);
        } catch {
          return false;
        }
      });
    }

    // Date range filter
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const sevenDaysAgoStart = new Date(startOfToday);
    sevenDaysAgoStart.setDate(sevenDaysAgoStart.getDate() - 6); // includes today + past 6 = 7 days
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const isInRange = (createdAt?: string) => {
      if (!createdAt) return false;
      const d = new Date(createdAt);
      if (isNaN(d.getTime())) return false;
      switch (dateRange) {
        case 'Today':
          return d >= startOfToday && d <= endOfToday;
        case 'Last 7 days':
          return d >= sevenDaysAgoStart && d <= endOfToday;
        case 'This Month':
          return d >= startOfMonth && d <= endOfMonth;
        default:
          return true;
      }
    };

    updatedData = updatedData.filter(item => isInRange(item.created_at));

    setFilteredData(updatedData);
  }, [searchTerm, filterOption, dateRange, tableData]);

  // Calculate total amount whenever x-ray tests or discount change
  useEffect(() => {
    const total = formData.xrayTests.reduce((sum, test) => sum + (test.amount || 0), 0);
    const finalAmount = Math.max(0, total - (formData.discount || 0));
    setFormData(prev => ({ ...prev, totalAmount: finalAmount }));
  }, [formData.xrayTests, formData.discount]);

  // Handle form input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Handle changes for a specific X-ray test
  const handleTestChange = (index: number, e: React.ChangeEvent<HTMLSelectElement>) => {
    const { name, value } = e.target;
    const newTests = [...formData.xrayTests];
    
    if (name === 'examination') {
      const selectedXray = dummyXrays.find(x => x.name === value);
      newTests[index] = {
        ...newTests[index],
        examination: value,
        amount: selectedXray ? selectedXray.amount : 0,
      };
    } else if (name === 'views') {
      newTests[index] = { ...newTests[index], views: parseInt(value, 10) };
    } else if (name === 'xrayVia') {
      newTests[index] = { ...newTests[index], xrayVia: value };
    }
    setFormData(prev => ({ ...prev, xrayTests: newTests }));
  };

  // Add a new X-ray test section
  const handleAddTest = () => {
    setFormData(prev => ({
      ...prev,
      xrayTests: [...prev.xrayTests, { examination: '', amount: 0, views: 1, xrayVia: 'Price' }]
    }));
  };

  // Remove an X-ray test section
  const handleRemoveTest = (index: number) => {
    if (formData.xrayTests.length > 1) {
      const newTests = formData.xrayTests.filter((_, i) => i !== index);
      setFormData(prev => ({ ...prev, xrayTests: newTests }));
    }
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage('');
    setMessageType('');

    try {
      // Prepare data in the requested JSON format
      const amountDetail = [{
        TotalAmount: formData.totalAmount,
        Discount: formData.discount,
        PaymentMethod: formData.paymentMethod,
        CashType: formData.paymentMethod.includes('Cash') ? formData.cashType : null,
        OnlineType: formData.paymentMethod.includes('Online') ? formData.onlineType : null,
      }];

      const xrayDetail = formData.xrayTests.map(test => ({
        Examination: test.examination,
        Amount: test.amount,
        View: test.views,
        Xray_Via: test.xrayVia,
      }));
      
      const dataToInsert = {
        name: formData.name,
        number: formData.phoneNumber,
        age: formData.age,
        age_unit: formData.ageUnit,
        Hospital_name: formData.hospitalName,
        bill_number: formData.billNumber,
        amount_detail: amountDetail,
        'x-ray_detail': xrayDetail, 
      };
      
      console.log('Data to insert:', dataToInsert);
      
      // Insert data into Supabase
      const result = await withRetry(async () => await supabase.from('x-raydetail').insert(dataToInsert));
      
      if (result.error) {
        console.error('Submission error:', result.error);
        setMessage(`Failed to submit the form: ${result.error.message || 'Unknown error'}`);
        setMessageType('error');
      } else {
        setMessage('Form submitted successfully!');
        setMessageType('success');
        // Reset form and refetch data
        setFormData({
          name: '', phoneNumber: '', age: '', ageUnit: 'Years',
          hospitalName: 'MEDFORD HOSPITAL', billNumber: '',
          xrayTests: [{ examination: '', amount: 0, views: 1, xrayVia: 'Price' }],
          totalAmount: 0, discount: 0, paymentMethod: 'Cash', cashType: 'Cash', onlineType: 'Credit card'
        });
        fetchData();
      }
    } catch (err) {
      console.error('Unexpected error:', err);
      setMessage('An unexpected error occurred.');
      setMessageType('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle delete action
  const handleDelete = async (id: string) => {
    // I have to remove the confirm pop-up here since it will not work in the Canvas environment.
    // Instead, I'll delete directly.
    setIsLoading(true);
    const result = await withRetry(async () => await supabase.from('x-raydetail').delete().eq('id', id));
    if (result.error) {
      console.error('Deletion error:', result.error);
      setMessage('Failed to delete the record.');
      setMessageType('error');
    } else {
      setMessage('Record deleted successfully.');
      setMessageType('success');
      fetchData();
    }
    setIsLoading(false);
  };

  // Handle view action
  const handleView = (data: any) => {
    setModalData(data);
    setShowModal(true);
  };

  return (
    <div className="flex-1 p-8 bg-gray-100 min-h-screen font-sans">
      <h1 className="text-4xl font-extrabold text-gray-900 mb-8 flex items-center">
        <Stethoscope className="mr-4 w-10 h-10 text-blue-600" />
        X-ray Entry Portal
      </h1>
      <Card className="bg-white p-8 rounded-2xl shadow-xl border border-gray-200">
        <form onSubmit={handleSubmit}>
          {/* Personal Information Section */}
          <div className="mb-10 p-6 bg-blue-50 rounded-xl border border-blue-200">
            <h2 className="text-2xl font-bold text-blue-800 mb-6 flex items-center">
              <UserPlus className="mr-3 w-6 h-6 text-blue-600" />
              Patient Information
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              <div className="flex flex-col">
                <Label className="text-sm font-semibold text-gray-700 mb-2" htmlFor="name">Patient Name</Label>
                <Input
                  type="text"
                  name="name"
                  id="name"
                  placeholder="Enter full name"
                  value={formData.name}
                  onChange={handleChange}
                  className="p-3 border border-gray-300 rounded-lg focus-visible:ring-blue-500"
                  required
                />
              </div>
              <div className="flex flex-col">
                <Label className="text-sm font-semibold text-gray-700 mb-2" htmlFor="phoneNumber">Phone Number</Label>
                <Input
                  type="tel"
                  name="phoneNumber"
                  id="phoneNumber"
                  placeholder="Enter phone number"
                  value={formData.phoneNumber}
                  onChange={handleChange}
                  className="p-3 border border-gray-300 rounded-lg focus-visible:ring-blue-500"
                />
              </div>
              <div className="flex flex-col">
                <Label className="text-sm font-semibold text-gray-700 mb-2" htmlFor="billNumber">Bill Number</Label>
                <Input
                  type="text"
                  name="billNumber"
                  id="billNumber"
                  placeholder="Enter bill number"
                  value={formData.billNumber}
                  onChange={handleChange}
                  className="p-3 border border-gray-300 rounded-lg focus-visible:ring-blue-500"
                  required
                />
              </div>
              <div className="flex flex-col">
                <Label className="text-sm font-semibold text-gray-700 mb-2" htmlFor="age">Age</Label>
                <Input
                  type="number"
                  name="age"
                  id="age"
                  placeholder="Enter age"
                  value={formData.age}
                  onChange={handleChange}
                  className="p-3 border border-gray-300 rounded-lg focus-visible:ring-blue-500"
                />
              </div>
              <div className="flex flex-col">
                <Label className="text-sm font-semibold text-gray-700 mb-2" htmlFor="ageUnit">Age Unit</Label>
                <Select value={formData.ageUnit} onValueChange={(value) => setFormData(prev => ({ ...prev, ageUnit: value }))}>
                  <SelectTrigger className="p-3 h-auto border border-gray-300 rounded-lg focus-visible:ring-blue-500">
                    <SelectValue placeholder="Select age unit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Years">Years</SelectItem>
                    <SelectItem value="Month">Month</SelectItem>
                    <SelectItem value="Day">Day</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col">
                <Label className="text-sm font-semibold text-gray-700 mb-2" htmlFor="hospitalName">Hospital Name</Label>
                <Select value={formData.hospitalName} onValueChange={(value) => setFormData(prev => ({ ...prev, hospitalName: value }))}>
                  <SelectTrigger className="p-3 h-auto border border-gray-300 rounded-lg focus-visible:ring-blue-500">
                    <SelectValue placeholder="Select hospital" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MEDFORD HOSPITAL">MEDFORD HOSPITAL</SelectItem>
                    <SelectItem value="Gautami Medford NX Hospital">Gautami Medford NX Hospital</SelectItem>
                    <SelectItem value="Apex Clinic">Apex Clinic</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* X-ray Test Section */}
          <div className="mb-10 p-6 bg-green-50 rounded-xl border border-green-200">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-green-800 flex items-center">
                <FlaskConical className="mr-3 w-6 h-6 text-green-600" />
                X-ray Tests
              </h2>
              <Button type="button" onClick={handleAddTest} className="bg-green-600 hover:bg-green-700 text-white rounded-lg px-4 py-2 text-sm font-semibold shadow-md transition-colors duration-200">
                <UserPlus className="mr-2 h-4 w-4" /> Add Test
              </Button>
            </div>
            {formData.xrayTests.map((test, index) => (
              <div key={index} className="relative grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 p-6 bg-white rounded-lg shadow-sm border border-gray-200 mt-4">
                {formData.xrayTests.length > 1 && (
                  <Button
                    type="button"
                    onClick={() => handleRemoveTest(index)}
                    className="absolute top-2 right-2 p-1 h-8 w-8 text-red-500 hover:bg-red-100"
                    variant="ghost"
                    title="Remove Test"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
                <div className="flex flex-col">
                  <Label className="text-sm font-semibold text-gray-700 mb-2" htmlFor={`examination-${index}`}>Examination</Label>
                  <Select value={test.examination} onValueChange={(value) => handleTestChange(index, { target: { name: 'examination', value } } as any)}>
                    <SelectTrigger className="p-3 h-auto border border-gray-300 rounded-lg focus-visible:ring-blue-500">
                      <SelectValue placeholder="Select Examination" />
                    </SelectTrigger>
                    <SelectContent>
                      {dummyXrays.map(xray => (
                        <SelectItem key={xray.name} value={xray.name}>{xray.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col">
                  <Label className="text-sm font-semibold text-gray-700 mb-2" htmlFor={`amount-${index}`}>Amount</Label>
                  <Input
                    type="number"
                    name="amount"
                    id={`amount-${index}`}
                    value={test.amount}
                    readOnly
                    className="p-3 border border-gray-300 rounded-lg bg-gray-100 cursor-not-allowed"
                  />
                </div>
                <div className="flex flex-col">
                  <Label className="text-sm font-semibold text-gray-700 mb-2" htmlFor={`views-${index}`}>Views</Label>
                  <Select value={String(test.views)} onValueChange={(value) => handleTestChange(index, { target: { name: 'views', value } } as any)}>
                    <SelectTrigger className="p-3 h-auto border border-gray-300 rounded-lg focus-visible:ring-blue-500">
                      <SelectValue placeholder="Select views" />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5].map(v => (
                        <SelectItem key={v} value={String(v)}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col">
                  <Label className="text-sm font-semibold text-gray-700 mb-2" htmlFor={`xrayVia-${index}`}>X-ray Via</Label>
                  <Select value={test.xrayVia} onValueChange={(value) => handleTestChange(index, { target: { name: 'xrayVia', value } } as any)}>
                    <SelectTrigger className="p-3 h-auto border border-gray-300 rounded-lg focus-visible:ring-blue-500">
                      <SelectValue placeholder="Select via" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Price">Price</SelectItem>
                      <SelectItem value="Ward">Ward</SelectItem>
                      <SelectItem value="ICU">ICU</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>

          {/* Payment Detail Section */}
          <div className="mb-10 p-6 bg-indigo-50 rounded-xl border border-indigo-200">
            <h2 className="text-2xl font-bold text-indigo-800 mb-6 flex items-center">
              <FlaskConical className="mr-3 w-6 h-6 text-indigo-600" />
              Payment Details
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              <div className="flex flex-col">
                <Label className="text-sm font-semibold text-gray-700 mb-2" htmlFor="totalAmount">Total Amount</Label>
                <Input
                  type="number"
                  name="totalAmount"
                  id="totalAmount"
                  value={formData.totalAmount}
                  readOnly
                  className="p-3 border border-gray-300 rounded-lg bg-gray-100 cursor-not-allowed"
                />
              </div>
              <div className="flex flex-col">
                <Label className="text-sm font-semibold text-gray-700 mb-2" htmlFor="discount">Discount</Label>
                <Input
                  type="number"
                  name="discount"
                  id="discount"
                  value={formData.discount}
                  onChange={handleChange}
                  className="p-3 border border-gray-300 rounded-lg focus-visible:ring-blue-500"
                />
              </div>
              <div className="flex flex-col">
                <Label className="text-sm font-semibold text-gray-700 mb-2" htmlFor="paymentMethod">Payment Method</Label>
                <Select value={formData.paymentMethod} onValueChange={(value) => setFormData(prev => ({ ...prev, paymentMethod: value }))}>
                  <SelectTrigger className="p-3 h-auto border border-gray-300 rounded-lg focus-visible:ring-blue-500">
                    <SelectValue placeholder="Select payment method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Cash">Cash</SelectItem>
                    <SelectItem value="Online">Online</SelectItem>
                    <SelectItem value="Cash+Online">Cash+Online</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {formData.paymentMethod.includes('Cash') && (
                <div className="flex flex-col">
                  <Label className="text-sm font-semibold text-gray-700 mb-2" htmlFor="cashType">Cash Type</Label>
                  <Select value={formData.cashType} onValueChange={(value) => setFormData(prev => ({ ...prev, cashType: value }))}>
                    <SelectTrigger className="p-3 h-auto border border-gray-300 rounded-lg focus-visible:ring-blue-500">
                      <SelectValue placeholder="Select cash type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Cash">Cash</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {formData.paymentMethod.includes('Online') && (
                <div className="flex flex-col">
                  <Label className="text-sm font-semibold text-gray-700 mb-2" htmlFor="onlineType">Online Type</Label>
                  <Select value={formData.onlineType} onValueChange={(value) => setFormData(prev => ({ ...prev, onlineType: value }))}>
                    <SelectTrigger className="p-3 h-auto border border-gray-300 rounded-lg focus-visible:ring-blue-500">
                      <SelectValue placeholder="Select online type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Credit card">Credit card</SelectItem>
                      <SelectItem value="Debit Card">Debit Card</SelectItem>
                      <SelectItem value="UPI">UPI</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          {/* Form Submission and Message */}
          {message && (
            <div className={cn("p-4 mb-6 rounded-lg font-medium", messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
              {message}
            </div>
          )}

          <div className="flex justify-center">
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-12 rounded-full shadow-lg transition-transform duration-200 hover:scale-105 disabled:bg-gray-400"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Entry'}
            </Button>
          </div>
        </form>
      </Card>

      {/* --- */}

      {/* Data Table Section */}
      <div className="mt-12">
        <div className="flex flex-col md:flex-row justify-between items-center mb-6">
          <h2 className="text-3xl font-bold text-gray-800 mb-4 md:mb-0 flex items-center">
            <Stethoscope className="mr-2 w-7 h-7 text-blue-600" />
            X-RAY Database
          </h2>
          <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4 w-full md:w-auto">
            <div className="relative w-full sm:w-auto">
              <Input
                type="text"
                placeholder="Search by name, contact, bill..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus-visible:ring-blue-500 w-full"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            </div>
            <div className="relative w-full sm:w-auto">
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus-visible:ring-blue-500 w-full">
                  <SelectValue placeholder="Date Range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Today">Today</SelectItem>
                  <SelectItem value="Last 7 days">Last 7 days</SelectItem>
                  <SelectItem value="This Month">This Month</SelectItem>
                </SelectContent>
              </Select>
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            </div>
            <div className="relative w-full sm:w-auto">
              <Select value={filterOption} onValueChange={setFilterOption}>
                <SelectTrigger className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus-visible:ring-blue-500 w-full">
                  <SelectValue placeholder="Filter by Via" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Vias</SelectItem>
                  <SelectItem value="Price">Price</SelectItem>
                  <SelectItem value="Ward">Ward</SelectItem>
                  <SelectItem value="ICU">ICU</SelectItem>
                </SelectContent>
              </Select>
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            </div>
          </div>
        </div>
        <Card className="overflow-hidden bg-white rounded-2xl shadow-xl">
          <div className="overflow-x-auto">
            {isLoading ? (
              <div className="p-8 text-center text-gray-500">Loading data...</div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Name</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Contact</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Age</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Examination</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Total Amount</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredData.length > 0 ? (
                    filteredData.map((row: any) => (
                      <tr key={row.id} className="hover:bg-gray-50 transition-colors duration-150">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{row.name}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{row.number}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{`${row.age} ${row.age_unit}`}</td>
                        <td className="px-6 py-4 text-sm text-gray-700 max-w-xs overflow-hidden">
                          <ul className="list-disc list-inside space-y-1">
                            {(() => {
                              try {
                                const data = typeof row['x-ray_detail'] === 'string' ? JSON.parse(row['x-ray_detail']) : row['x-ray_detail'];
                                return data && Array.isArray(data) ? data.map((test: any, idx: number) => (
                                  <li key={idx} className="text-xs text-gray-700 truncate">
                                    {test.Examination}
                                  </li>
                                )) : <span className="text-xs text-gray-400">No tests</span>;
                              } catch (error) {
                                return <span className="text-xs text-gray-400">N/A</span>;
                              }
                            })()}
                          </ul>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700">
                          ₹{(() => {
                            try {
                              const data = typeof row['amount_detail'] === 'string' ? JSON.parse(row['amount_detail']) : row['amount_detail'];
                              return data[0]?.TotalAmount || 'N/A';
                            } catch (error) {
                              return 'N/A';
                            }
                          })()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <div className="flex items-center space-x-2">
                            <Button onClick={() => handleView(row)} className="p-2 h-8 w-8 text-blue-600 hover:bg-blue-50 transition-colors" variant="ghost">
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button onClick={() => handleDelete(row.id)} className="p-2 h-8 w-8 text-red-600 hover:bg-red-50 transition-colors" variant="ghost">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-4 text-center text-gray-500">No records found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>

      {/*
        ------------------------------------------
        View Details Modal - Professional Redesign
        ------------------------------------------
      */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto p-8 rounded-2xl shadow-2xl bg-white border border-gray-200">
          {modalData && (
            <>
              <DialogHeader className="mb-6">
                <DialogTitle className="text-3xl font-extrabold text-gray-800">
                  <span className="text-blue-600">{modalData.name}'s</span> X-ray Bill
                </DialogTitle>
                <p className="text-sm text-gray-500">Generated on {formatDate(modalData.created_at)}</p>
              </DialogHeader>

              <div className="space-y-6">
                <Card className="bg-gray-50 border border-gray-200 shadow-none">
                  <CardHeader>
                    <CardTitle className="text-xl font-bold text-gray-700">Patient Information</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div className="flex justify-between items-center"><span className="font-semibold">Name:</span> <span className="text-right">{modalData.name}</span></div>
                    <div className="flex justify-between items-center"><span className="font-semibold">Phone Number:</span> <span className="text-right">{modalData.number}</span></div>
                    <div className="flex justify-between items-center"><span className="font-semibold">Age:</span> <span className="text-right">{`${modalData.age} ${modalData.age_unit}`}</span></div>
                    <div className="flex justify-between items-center"><span className="font-semibold">Hospital:</span> <span className="text-right">{modalData.Hospital_name}</span></div>
                    <div className="flex justify-between items-center"><span className="font-semibold">Bill No.:</span> <span className="text-right">{modalData.bill_number}</span></div>
                  </CardContent>
                </Card>

                <Card className="bg-white border border-gray-200 shadow-none">
                  <CardHeader>
                    <CardTitle className="text-xl font-bold text-gray-700">X-ray Test Details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {(() => {
                      try {
                        const data = typeof modalData['x-ray_detail'] === 'string' ? JSON.parse(modalData['x-ray_detail']) : modalData['x-ray_detail'];
                        return data && Array.isArray(data) && data.length > 0 ? (
                          <div className="space-y-2">
                            {data.map((test: any, index: number) => (
                              <div key={index} className="flex justify-between items-center bg-gray-100 p-3 rounded-lg text-sm">
                                <span className="font-semibold">{test.Examination}</span>
                                <div className="flex-grow border-b border-dotted mx-4"></div>
                                <span className="font-normal">
                                  Views: {test.View} • Via: {test.Xray_Via} • Amount: ₹{test.Amount}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : <div className="text-center text-gray-400">No tests recorded.</div>;
                      } catch (error) {
                        return <div className="text-center text-red-500">Error loading test details</div>;
                      }
                    })()}
                  </CardContent>
                </Card>

                <Card className="bg-white border border-gray-200 shadow-none">
                  <CardHeader>
                    <CardTitle className="text-xl font-bold text-gray-700">Payment Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {(() => {
                      try {
                        const data = typeof modalData['amount_detail'] === 'string' ? JSON.parse(modalData['amount_detail']) : modalData['amount_detail'];
                        const payment = data && Array.isArray(data) ? data[0] : null;
                        if (!payment) return <div className="text-center text-gray-400">No payment details.</div>;

                        return (
                          <div className="space-y-2">
                            <div className="flex justify-between font-medium">
                              <span>Total Bill Amount:</span>
                              <span>₹{payment.TotalAmount + (payment.Discount || 0)}</span>
                            </div>
                            <div className="flex justify-between font-medium">
                              <span>Discount:</span>
                              <span className="text-red-600">- ₹{payment.Discount}</span>
                            </div>
                            <div className="flex justify-between text-lg font-bold text-green-600 pt-2 border-t mt-2">
                              <span>Final Amount Paid:</span>
                              <span>₹{payment.TotalAmount}</span>
                            </div>
                            <div className="flex justify-between font-medium pt-2 text-gray-600">
                              <span>Payment Method:</span>
                              <span>{payment.PaymentMethod}</span>
                            </div>
                            {payment.CashType && (
                              <div className="flex justify-between font-medium text-gray-600">
                                <span>Cash Type:</span>
                                <span>{payment.CashType}</span>
                              </div>
                            )}
                            {payment.OnlineType && (
                              <div className="flex justify-between font-medium text-gray-600">
                                <span>Online Type:</span>
                                <span>{payment.OnlineType}</span>
                              </div>
                            )}
                          </div>
                        );
                      } catch (error) {
                        return <div className="text-center text-red-500">Error loading payment details</div>;
                      }
                    })()}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
          <Button
            onClick={() => setShowModal(false)}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-2"
            variant="ghost"
          >
            <X className="h-6 w-6" />
            <span className="sr-only">Close</span>
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}