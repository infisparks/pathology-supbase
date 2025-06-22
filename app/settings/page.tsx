'use client'


import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Settings, User, Bell, Database, Shield } from 'lucide-react'

export default function SettingsPage() {
  return (
    <div className="flex h-screen bg-gray-50">
     
      <div className="flex-1 overflow-auto">
        <div className="p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
            <p className="text-gray-600 mt-2">
              Configure your laboratory management system
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Lab Information */}
            <Card>
              <CardHeader>
                <div className="flex items-center space-x-2">
                  <Settings className="h-5 w-5 text-blue-600" />
                  <CardTitle>Lab Information</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="labName">Laboratory Name</Label>
                  <Input 
                    id="labName" 
                    defaultValue="MEDFORD HOSPITAL" 
                    className="mt-1" 
                  />
                </div>
                <div>
                  <Label htmlFor="labAddress">Address</Label>
                  <Input 
                    id="labAddress" 
                    placeholder="Enter lab address" 
                    className="mt-1" 
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="labPhone">Phone</Label>
                    <Input 
                      id="labPhone" 
                      placeholder="Phone number" 
                      className="mt-1" 
                    />
                  </div>
                  <div>
                    <Label htmlFor="labEmail">Email</Label>
                    <Input 
                      id="labEmail" 
                      type="email" 
                      placeholder="Email address" 
                      className="mt-1" 
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* User Management */}
            <Card>
              <CardHeader>
                <div className="flex items-center space-x-2">
                  <User className="h-5 w-5 text-green-600" />
                  <CardTitle>User Management</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="currentUser">Current User</Label>
                  <Input 
                    id="currentUser" 
                    defaultValue="admin@medford.com" 
                    disabled 
                    className="mt-1" 
                  />
                </div>
                <div>
                  <Label htmlFor="changePassword">Change Password</Label>
                  <Input 
                    id="changePassword" 
                    type="password" 
                    placeholder="New password" 
                    className="mt-1" 
                  />
                </div>
                <Button className="w-full bg-green-600 hover:bg-green-700">
                  Update Password
                </Button>
              </CardContent>
            </Card>

            {/* Notifications */}
            <Card>
              <CardHeader>
                <div className="flex items-center space-x-2">
                  <Bell className="h-5 w-5 text-yellow-600" />
                  <CardTitle>Notifications</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Email Notifications</Label>
                    <p className="text-sm text-gray-600">Receive notifications via email</p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <Label>SMS Notifications</Label>
                    <p className="text-sm text-gray-600">Send SMS to patients</p>
                  </div>
                  <Switch />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Payment Reminders</Label>
                    <p className="text-sm text-gray-600">Automated payment reminders</p>
                  </div>
                  <Switch defaultChecked />
                </div>
              </CardContent>
            </Card>

            {/* Database */}
            <Card>
              <CardHeader>
                <div className="flex items-center space-x-2">
                  <Database className="h-5 w-5 text-purple-600" />
                  <CardTitle>Database</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Auto Backup</Label>
                    <p className="text-sm text-gray-600">Automatic daily backups</p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <Separator />
                <div>
                  <Label>Last Backup</Label>
                  <p className="text-sm text-gray-600 mt-1">Today, 12:00 AM</p>
                </div>
                <Button variant="outline" className="w-full">
                  Create Backup Now
                </Button>
              </CardContent>
            </Card>

            {/* Security */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <div className="flex items-center space-x-2">
                  <Shield className="h-5 w-5 text-red-600" />
                  <CardTitle>Security Settings</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>Two-Factor Authentication</Label>
                        <p className="text-sm text-gray-600">Add extra security to your account</p>
                      </div>
                      <Switch />
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>Session Timeout</Label>
                        <p className="text-sm text-gray-600">Auto logout after inactivity</p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <Label>Session Timeout Duration</Label>
                      <Input 
                        defaultValue="30" 
                        className="mt-1" 
                        placeholder="Minutes"
                      />
                    </div>
                    <div>
                      <Label>Max Login Attempts</Label>
                      <Input 
                        defaultValue="5" 
                        className="mt-1" 
                        placeholder="Attempts"
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="mt-8 flex justify-end space-x-4">
            <Button variant="outline">Reset to Defaults</Button>
            <Button className="bg-blue-600 hover:bg-blue-700">
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}