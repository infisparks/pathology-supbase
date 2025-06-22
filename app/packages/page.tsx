'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Search, Plus, Edit, Trash2, Package } from 'lucide-react'

interface TestPackage {
  id: number
  package_name: string
  discount: number
  tests: any[]
  created_at: string
}

export default function PackagesPage() {
  const [packages, setPackages] = useState<TestPackage[]>([])
  const [filteredPackages, setFilteredPackages] = useState<TestPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    fetchPackages()
  }, [])

  useEffect(() => {
    if (searchTerm.trim()) {
      const filtered = packages.filter(pkg =>
        pkg.package_name.toLowerCase().includes(searchTerm.toLowerCase())
      )
      setFilteredPackages(filtered)
    } else {
      setFilteredPackages(packages)
    }
  }, [searchTerm, packages])

  const fetchPackages = async () => {
    try {
      const { data, error } = await supabase
        .from('packages')
        .select('*')
        .order('package_name')

      if (error) throw error
      setPackages(data || [])
      setFilteredPackages(data || [])
    } catch (error) {
      console.error('Error fetching packages:', error)
    } finally {
      setLoading(false)
    }
  }

  const calculatePackageValue = (tests: any[]) => {
    if (!Array.isArray(tests)) return 0
    return tests.reduce((total, test) => total + (test.price || 0), 0)
  }

  if (loading) {
    return (
      <div className="flex h-screen bg-gray-50">
       
        <div className="flex-1 p-8">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-gray-200 rounded w-1/4"></div>
            <div className="h-64 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-50">
      
      <div className="flex-1 overflow-auto">
        <div className="p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Test Packages</h1>
            <p className="text-gray-600 mt-2">
              Manage test packages and bundle offers
            </p>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Package Database</CardTitle>
                <div className="flex items-center space-x-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                    <Input
                      placeholder="Search packages..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 w-64"
                    />
                  </div>
                  <Badge variant="outline">
                    {filteredPackages.length} packages
                  </Badge>
                  <Button className="bg-blue-600 hover:bg-blue-700">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Package
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Package Name</TableHead>
                      <TableHead>Tests Included</TableHead>
                      <TableHead>Total Value</TableHead>
                      <TableHead>Discount</TableHead>
                      <TableHead>Final Price</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPackages.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                          {searchTerm ? 'No packages found matching your search.' : 'No packages available.'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredPackages.map((pkg) => {
                        const totalValue = calculatePackageValue(pkg.tests)
                        const discountAmount = (totalValue * pkg.discount) / 100
                        const finalPrice = totalValue - discountAmount

                        return (
                          <TableRow key={pkg.id}>
                            <TableCell>
                              <div className="flex items-center space-x-2">
                                <Package className="h-4 w-4 text-blue-600" />
                                <span className="font-medium">{pkg.package_name}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">
                                {Array.isArray(pkg.tests) ? (
                                  <div>
                                    <span className="font-medium">{pkg.tests.length} tests</span>
                                    <div className="text-xs text-gray-500 mt-1">
                                      {pkg.tests.slice(0, 2).map((test, index) => (
                                        <div key={index}>{test.testName}</div>
                                      ))}
                                      {pkg.tests.length > 2 && (
                                        <div>+{pkg.tests.length - 2} more...</div>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-gray-400">No tests</span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="font-medium">₹{totalValue}</span>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">
                                {pkg.discount}% OFF
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div>
                                <span className="font-medium text-green-600">₹{finalPrice}</span>
                                {discountAmount > 0 && (
                                  <div className="text-xs text-gray-500">
                                    Save ₹{discountAmount}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm text-gray-600">
                                {new Date(pkg.created_at).toLocaleDateString('en-IN')}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center space-x-2">
                                <Button variant="ghost" size="sm">
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}