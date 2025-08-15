'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { UserPlus, FlaskConical, Stethoscope, Eye, Trash2, Search, Filter, X, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { format } from 'date-fns';
// Import the new JSON data for examinations and prices
import { xrayData } from './index';

// Helper function to format date
const formatDate = (dateString: string): string => {
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return new Date(dateString).toLocaleDateString(undefined, options);
};

// Prepare a map for easy lookup of examination prices
const examinationPriceMap = xrayData.xray_price_list.reduce<Record<string, any>>((acc, item) => {
  acc[item.examination] = item;
  return acc;
}, {});

// Prepare a map for easy lookup of procedure prices
const procedurePriceMap = xrayData.procedure.reduce<Record<string, any>>((acc, item) => {
  acc[item.name] = item;
  return acc;
}, {});

// Combine all examinations and procedures into a single list for the dropdown
const allExaminations = [
  ...xrayData.xray_price_list.map(item => item.examination),
  ...xrayData.procedure.map(item => item.name)
];

// Separate examinations and procedures for better organization
const regularExaminations = xrayData.xray_price_list.map(item => item.examination);
const procedureExaminations = xrayData.procedure.map(item => item.name);

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
    onlineType: 'UPI',
  });

  const [tableData, setTableData] = useState<any[]>([]);
  const [filteredData, setFilteredData] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterOption, setFilterOption] = useState('All');
  const [dateRange, setDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({
    from: new Date(),
    to: new Date(),
  });
  const [quickDateRange, setQuickDateRange] = useState('Today');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalData, setModalData] = useState<any | null>(null);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

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
    const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const endOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
    const now = new Date();
    let fromDate: Date | null = null;
    let toDate: Date | null = null;

    if (quickDateRange === 'Today') {
      fromDate = startOfDay(now);
      toDate = endOfDay(now);
    } else if (quickDateRange === 'Last 7 days') {
      const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
      fromDate = sevenDaysAgo;
      toDate = endOfDay(now);
    } else if (quickDateRange === 'This Month') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      fromDate = startOfMonth;
      toDate = endOfMonth;
    } else if (dateRange.from && dateRange.to) {
      fromDate = startOfDay(dateRange.from);
      toDate = endOfDay(dateRange.to);
    }

    updatedData = updatedData.filter(item => {
      if (!item.created_at) return false;
      const itemDate = new Date(item.created_at);
      if (fromDate && itemDate < fromDate) return false;
      if (toDate && itemDate > toDate) return false;
      return true;
    });

    setFilteredData(updatedData);
  }, [searchTerm, filterOption, quickDateRange, dateRange, tableData]);

  const handleDateRangeChange = (range: { from: Date | undefined; to: Date | undefined }) => {
    setDateRange(range);
    setQuickDateRange('Custom');
  };

  const handleQuickDateRangeChange = (value: string) => {
    setQuickDateRange(value);
    const now = new Date();
    if (value === 'Today') {
      setDateRange({ from: now, to: now });
    } else if (value === 'Last 7 days') {
      const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
      setDateRange({ from: sevenDaysAgo, to: now });
    } else if (value === 'This Month') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setDateRange({ from: startOfMonth, to: endOfMonth });
    } else {
      setDateRange({ from: undefined, to: undefined });
    }
  };

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

  // Handle select changes for a specific X-ray test
  const handleTestSelectChange = (index: number, name: string, value: string) => {
    const newTests = [...formData.xrayTests];
    if (name === 'examination') {
      // Find the price data based on the selected examination
      const xrayItem = examinationPriceMap[value];
      const procedureItem = procedurePriceMap[value];
      let amount = 0;

      if (xrayItem) {
        // Use the selected via to determine the price
        const viaKey = newTests[index].xrayVia.toLowerCase();
        amount = xrayItem[viaKey];
      } else if (procedureItem) {
        amount = procedureItem.price;
      }

      newTests[index] = {
        ...newTests[index],
        examination: value,
        amount: amount,
      };
      setSearchQuery(''); // Clear search query after selection
    } else if (name === 'views') {
      newTests[index] = { ...newTests[index], views: parseInt(value, 10) };
    } else if (name === 'xrayVia') {
      // When X-ray Via changes, update the amount based on the current examination
      const currentExam = newTests[index].examination;
      const xrayItem = examinationPriceMap[currentExam];
      let amount = 0;
      if (xrayItem) {
        const viaKey = value.toLowerCase();
        amount = xrayItem[viaKey];
      }
      newTests[index] = { ...newTests[index], xrayVia: value, amount: amount };
    } else if (name === 'amount') {
      // Handle direct amount changes
      newTests[index] = { ...newTests[index], amount: parseFloat(value) || 0 };
    }
    setFormData(prev => ({ ...prev, xrayTests: newTests }));
  };

  // Check if examination is a procedure (HSG, IVP, BMFT, BM SWALLOW)
  const isProcedureExamination = (examination: string) => {
    return ['HSG', 'IVP', 'BMFT', 'BM SWALLOW'].includes(examination);
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

      const xrayDetail = formData.xrayTests.map(test => {
        const isProcedure = isProcedureExamination(test.examination);
        return {
          Examination: test.examination,
          Xray_Via: isProcedure ? 'N/A' : test.xrayVia,
          Amount: test.amount,
          View: test.views,
        };
      });

      const dataToInsert = {
        name: formData.name,
        number: formData.phoneNumber,
        age: formData.age,
        age_unit: formData.ageUnit,
        Hospital_name: formData.hospitalName,
        bill_number: formData.billNumber || null,
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
          totalAmount: 0, discount: 0, paymentMethod: 'Cash', cashType: 'Cash', onlineType: 'UPI'
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
              <div key={index} className="relative grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 p-6 bg-white rounded-lg shadow-sm border border-gray-200 mt-4">
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
                {/* Examination Dropdown */}
                <div className="flex flex-col">
                  <Label className="text-sm font-semibold text-gray-700 mb-2" htmlFor={`examination-${index}`}>Examination</Label>
                  <Select value={test.examination} onValueChange={(value) => handleTestSelectChange(index, 'examination', value)}>
                    <SelectTrigger className="p-3 h-auto border border-gray-300 rounded-lg focus-visible:ring-blue-500 hover:border-blue-400 transition-colors duration-200 bg-white shadow-sm">
                      <SelectValue placeholder="Select Examination" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px] overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                      {/* Regular Examinations Section */}
                      <div className="px-2 py-1">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-2 py-1.5 bg-gray-50 rounded-md mb-1">
                          Regular Examinations
                        </div>
                        {regularExaminations.map(exam => (
                          <SelectItem
                            key={exam}
                            value={exam}
                            className="relative pl-8 pr-3 py-2.5 text-sm hover:bg-blue-50 focus:bg-blue-50 cursor-pointer rounded-md transition-colors duration-150"
                          >
                            <span className="block truncate">{exam}</span>
                          </SelectItem>
                        ))}
                      </div>

                      {/* Divider */}
                      <div className="border-t border-gray-200 my-2"></div>

                      {/* Procedure Section */}
                      <div className="px-2 py-1">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-2 py-1.5 bg-orange-50 rounded-md mb-1">
                          Procedure
                        </div>
                        {procedureExaminations.map(exam => (
                          <SelectItem
                            key={exam}
                            value={exam}
                            className="relative pl-8 pr-3 py-2.5 text-sm hover:bg-orange-50 focus:bg-orange-50 cursor-pointer rounded-md transition-colors duration-150"
                          >
                            <span className="block truncate">{exam}</span>
                          </SelectItem>
                        ))}
                      </div>
                    </SelectContent>
                  </Select>
                </div>
                {/* X-ray Via */}
                <div className="flex flex-col">
                  <Label className="text-sm font-semibold text-gray-700 mb-2" htmlFor={`xrayVia-${index}`}>X-ray Via</Label>
                  {isProcedureExamination(test.examination) ? (
                    <Input
                      type="text"
                      value="N/A"
                      readOnly
                      className="p-3 border border-gray-300 rounded-lg bg-gray-100 cursor-not-allowed"
                    />
                  ) : (
                    <Select value={test.xrayVia} onValueChange={(value) => handleTestSelectChange(index, 'xrayVia', value)}>
                      <SelectTrigger className="p-3 h-auto border border-gray-300 rounded-lg focus-visible:ring-blue-500">
                        <SelectValue placeholder="Select via" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Price">Price</SelectItem>
                        <SelectItem value="Ward">Ward</SelectItem>
                        <SelectItem value="ICU">ICU</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
                {/* Amount */}
                <div className="flex flex-col">
                  <Label className="text-sm font-semibold text-gray-700 mb-2" htmlFor={`amount-${index}`}>Amount</Label>
                  <Input
                    type="number"
                    name="amount"
                    id={`amount-${index}`}
                    value={test.amount}
                    onChange={(e) => handleTestSelectChange(index, 'amount', e.target.value)}
                    className="p-3 border border-gray-300 rounded-lg focus-visible:ring-blue-500"
                  />
                </div>
                {/* Views */}
                <div className="flex flex-col">
                  <Label className="text-sm font-semibold text-gray-700 mb-2" htmlFor={`views-${index}`}>Views</Label>
                  <Select value={String(test.views)} onValueChange={(value) => handleTestSelectChange(index, 'views', value)}>
                    <SelectTrigger className="p-3 h-auto border border-gray-300 rounded-lg focus-visible:ring-blue-500">
                      <SelectValue placeholder="Select views" />
                    </SelectTrigger>
                    <SelectContent>
                      {[...Array(10)].map((_, v) => (
                        <SelectItem key={v + 1} value={String(v + 1)}>{v + 1}</SelectItem>
                      ))}
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
      <div className="mt-12 mb-10">
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
              <Select value={quickDateRange} onValueChange={handleQuickDateRangeChange}>
                <SelectTrigger className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus-visible:ring-blue-500 w-full">
                  <SelectValue placeholder="Quick Date Range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Today">Today</SelectItem>
                  <SelectItem value="Last 7 days">Last 7 days</SelectItem>
                  <SelectItem value="This Month">This Month</SelectItem>
                  <SelectItem value="Custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            </div>
            <div className="flex w-full sm:w-auto space-x-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={"outline"}
                    className={cn(
                      "w-full justify-start text-left font-normal pl-10",
                      !dateRange.from && "text-muted-foreground"
                    )}
                  >
                    <Calendar className="absolute left-3 w-5 h-5 text-gray-400" />
                    {dateRange.from ? format(dateRange.from, "dd-MM-yyyy") : "Start Date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={dateRange.from}
                    onSelect={(date) => handleDateRangeChange({ ...dateRange, from: date })}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={"outline"}
                    className={cn(
                      "w-full justify-start text-left font-normal pl-10",
                      !dateRange.to && "text-muted-foreground"
                    )}
                  >
                    <Calendar className="absolute left-3 w-5 h-5 text-gray-400" />
                    {dateRange.to ? format(dateRange.to, "dd-MM-yyyy") : "End Date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={dateRange.to}
                    onSelect={(date) => handleDateRangeChange({ ...dateRange, to: date })}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
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
          <div className="overflow-x-auto" style={{ maxHeight: 'calc(100vh - 400px)' }}>
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 sticky top-0">
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
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 text-center text-gray-500">Loading data...</td>
                  </tr>
                ) : (
                  filteredData.length > 0 ? (
                    filteredData.map((row: any) => (
                      <tr key={row.id} className="hover:bg-gray-50 transition-colors duration-150">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{row.name}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{row.number}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{`${row.age} ${row.age_unit}`}</td>
                                                 <td className="px-6 py-4 text-sm text-gray-700 max-w-xs">
                           <div className="max-h-20 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
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
                           </div>
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
                  )
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* View Details Modal */}
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
        </DialogContent>
      </Dialog>
    </div>
  );
}