'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/lib/store'
import type { Booking, BookingRequest } from '@/lib/types'

export default function CalendarPage() {
  const store = useAppStore()
  const controller = store.controllers.find((c) => c.roles.includes('cameras'))
  const isConnected = controller ? store.connectedControllers.has(controller.id) : false

  const [bookings, setBookings] = useState<Booking[]>([])
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [showingAddBooking, setShowingAddBooking] = useState(false)
  const [showingBookingDetail, setShowingBookingDetail] = useState<Booking | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const loadBookings = async () => {
    if (!controller || !controller.apiClient || !isConnected) return

    setIsLoading(true)
    try {
      const loadedBookings = await controller.apiClient.fetchBookings()
      setBookings(loadedBookings)
    } catch (error) {
      store.addLog({
        module: 'calendar',
        level: 'error',
        message: `Failed to load bookings: ${error instanceof Error ? error.message : 'Unknown error'}`,
        controllerID: controller.id,
        controllerName: controller.name,
      })
    } finally {
      setIsLoading(false)
    }
  }

  const addBooking = async (booking: BookingRequest) => {
    if (!controller || !controller.apiClient || !isConnected) {
      store.addLog({
        module: 'calendar',
        level: 'warn',
        message: 'Not connected to server, booking not saved',
        controllerID: controller?.id,
        controllerName: controller?.name,
      })
      return
    }

    try {
      const newBooking = await controller.apiClient.createBooking(booking)
      setBookings([...bookings, newBooking])
      store.addLog({
        module: 'calendar',
        level: 'info',
        message: `Added booking: ${newBooking.user_name}`,
        controllerID: controller.id,
        controllerName: controller.name,
      })
      setShowingAddBooking(false)
    } catch (error) {
      store.addLog({
        module: 'calendar',
        level: 'error',
        message: `Failed to add booking: ${error instanceof Error ? error.message : 'Unknown error'}`,
        controllerID: controller.id,
        controllerName: controller.name,
      })
    }
  }

  const updateBooking = async (id: string, booking: BookingRequest) => {
    if (!controller || !controller.apiClient || !isConnected) {
      store.addLog({
        module: 'calendar',
        level: 'warn',
        message: 'Not connected to server, booking not updated',
        controllerID: controller?.id,
        controllerName: controller?.name,
      })
      return
    }

    try {
      const updatedBooking = await controller.apiClient.updateBooking(id, booking)
      setBookings(bookings.map((b) => (b.id === id ? updatedBooking : b)))
      store.addLog({
        module: 'calendar',
        level: 'info',
        message: `Updated booking: ${updatedBooking.user_name}`,
        controllerID: controller.id,
        controllerName: controller.name,
      })
      setShowingBookingDetail(null)
    } catch (error) {
      store.addLog({
        module: 'calendar',
        level: 'error',
        message: `Failed to update booking: ${error instanceof Error ? error.message : 'Unknown error'}`,
        controllerID: controller.id,
        controllerName: controller.name,
      })
    }
  }

  const deleteBooking = async (id: string) => {
    if (!controller || !controller.apiClient || !isConnected) {
      store.addLog({
        module: 'calendar',
        level: 'warn',
        message: 'Not connected to server, booking not deleted',
        controllerID: controller?.id,
        controllerName: controller?.name,
      })
      return
    }

    try {
      await controller.apiClient.deleteBooking(id)
      setBookings(bookings.filter((b) => b.id !== id))
      store.addLog({
        module: 'calendar',
        level: 'info',
        message: 'Deleted booking',
        controllerID: controller.id,
        controllerName: controller.name,
      })
      setShowingBookingDetail(null)
    } catch (error) {
      store.addLog({
        module: 'calendar',
        level: 'error',
        message: `Failed to delete booking: ${error instanceof Error ? error.message : 'Unknown error'}`,
        controllerID: controller.id,
        controllerName: controller.name,
      })
    }
  }

  // Load bookings on mount and when connected
  useEffect(() => {
    if (controller && isConnected) {
      loadBookings()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, isConnected])

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!controller || !isConnected) return

    const interval = setInterval(() => {
      loadBookings()
    }, 30000)

    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, isConnected])

  const getMonthDays = () => {
    const year = selectedDate.getFullYear()
    const month = selectedDate.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const firstDayOfWeek = firstDay.getDay()
    const daysInMonth = lastDay.getDate()

    const days: (Date | null)[] = []
    // Add empty cells for days before the first day of the month
    for (let i = 0; i < firstDayOfWeek; i++) {
      days.push(null)
    }
    // Add all days in the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day))
    }
    return days
  }

  const hasBookings = (date: Date) => {
    return bookings.some((booking) => {
      const start = new Date(booking.start_time)
      const end = new Date(booking.end_time)
      return (
        isSameDay(start, date) ||
        isSameDay(end, date) ||
        (start <= date && end >= date)
      )
    })
  }

  const isSameDay = (date1: Date, date2: Date) => {
    return (
      date1.getFullYear() === date2.getFullYear() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getDate() === date2.getDate()
    )
  }

  const bookingsForDate = (date: Date) => {
    return bookings.filter((booking) => {
      const start = new Date(booking.start_time)
      const end = new Date(booking.end_time)
      return (
        isSameDay(start, date) ||
        isSameDay(end, date) ||
        (start <= date && end >= date)
      )
    })
  }

  const changeMonth = (direction: number) => {
    const newDate = new Date(selectedDate)
    newDate.setMonth(newDate.getMonth() + direction)
    setSelectedDate(newDate)
  }

  const monthYearString = selectedDate.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  if (!controller) {
    return (
      <div className="p-8">
        <div className="bg-apple-gray dark:bg-gray-800 rounded-2xl p-8 text-center">
          <p className="text-gray-600 dark:text-gray-400 text-lg">No camera controller configured</p>
          <p className="text-gray-500 dark:text-gray-500 mt-2">Add a controller in Settings</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold text-apple-dark dark:text-white mb-2">
          Camera Booking Calendar
        </h1>
        <p className="text-gray-600 dark:text-gray-400">Reserve time slots for camera control</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar */}
        <div className="lg:col-span-2 bg-apple-gray dark:bg-gray-800 rounded-2xl p-6">
          {/* Month header */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => changeMonth(-1)}
              className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="text-xl font-semibold text-apple-dark dark:text-white">{monthYearString}</h2>
            <button
              onClick={() => changeMonth(1)}
              className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className="text-center text-sm font-medium text-gray-600 dark:text-gray-400 py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {getMonthDays().map((date, index) => {
              if (!date) {
                return <div key={index} className="aspect-square" />
              }
              const isSelected = isSameDay(date, selectedDate)
              const isToday = isSameDay(date, new Date())
              const hasBooking = hasBookings(date)

              return (
                <button
                  key={date.getTime()}
                  onClick={() => setSelectedDate(date)}
                  className={`aspect-square p-2 rounded-lg transition-colors ${
                    isSelected
                      ? 'bg-apple-blue text-white'
                      : isToday
                      ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                      : 'hover:bg-gray-200 dark:hover:bg-gray-700 text-apple-dark dark:text-white'
                  }`}
                >
                  <div className="flex flex-col items-center">
                    <span className={`text-sm font-medium ${isSelected ? 'text-white' : ''}`}>
                      {date.getDate()}
                    </span>
                    {hasBooking && (
                      <div
                        className={`w-1.5 h-1.5 rounded-full mt-1 ${
                          isSelected ? 'bg-white' : 'bg-blue-500'
                        }`}
                      />
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Bookings list */}
        <div className="bg-apple-gray dark:bg-gray-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-apple-dark dark:text-white">
                Bookings for {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </h3>
              {isConnected && (
                <p className="text-xs text-green-600 dark:text-green-400 mt-1">● Online</p>
              )}
            </div>
            <button
              onClick={() => setShowingAddBooking(true)}
              disabled={!isConnected}
              className="px-3 py-1.5 bg-apple-blue text-white rounded-lg text-sm font-medium hover:bg-apple-blue-hover disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : bookingsForDate(selectedDate).length === 0 ? (
            <div className="text-center py-8 text-gray-500">No bookings for this date</div>
          ) : (
            <div className="space-y-2">
              {bookingsForDate(selectedDate)
                .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
                .map((booking) => (
                  <button
                    key={booking.id}
                    onClick={() => setShowingBookingDetail(booking)}
                    className="w-full text-left p-3 bg-white dark:bg-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                  >
                    <div className="font-medium text-apple-dark dark:text-white">{booking.user_name}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      {new Date(booking.start_time).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}{' '}
                      –{' '}
                      {new Date(booking.end_time).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </div>
                    {booking.notes && (
                      <div className="text-xs text-gray-500 dark:text-gray-500 mt-1 line-clamp-1">
                        {booking.notes}
                      </div>
                    )}
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Add Booking Modal */}
      {showingAddBooking && (
        <AddBookingModal
          selectedDate={selectedDate}
          onSave={addBooking}
          onClose={() => setShowingAddBooking(false)}
        />
      )}

      {/* Booking Detail Modal */}
      {showingBookingDetail && (
        <BookingDetailModal
          booking={showingBookingDetail}
          onUpdate={(id, booking) => updateBooking(id, booking)}
          onDelete={(id) => deleteBooking(id)}
          onClose={() => setShowingBookingDetail(null)}
        />
      )}
    </div>
  )
}

// Add Booking Modal Component
function AddBookingModal({
  selectedDate,
  onSave,
  onClose,
}: {
  selectedDate: Date
  onSave: (booking: BookingRequest) => void
  onClose: () => void
}) {
  const [userName, setUserName] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    const now = new Date(selectedDate)
    now.setHours(new Date().getHours(), new Date().getMinutes(), 0, 0)
    const end = new Date(now)
    end.setHours(end.getHours() + 1)

    const formatDateTime = (date: Date) => {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const hours = String(date.getHours()).padStart(2, '0')
      const minutes = String(date.getMinutes()).padStart(2, '0')
      return `${year}-${month}-${day}T${hours}:${minutes}`
    }

    setStartTime(formatDateTime(now))
    setEndTime(formatDateTime(end))
  }, [selectedDate])

  const handleSave = () => {
    if (!userName || !startTime || !endTime) return

    const start = new Date(startTime)
    const end = new Date(endTime)

    if (end <= start) {
      alert('End time must be after start time')
      return
    }

    onSave({
      user_name: userName,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      notes: notes || undefined,
    })
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md">
        <h2 className="text-xl font-semibold mb-4 text-apple-dark dark:text-white">New Booking</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-apple-dark dark:text-white">
              User Name
            </label>
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-apple-dark dark:text-white"
              placeholder="Your name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-apple-dark dark:text-white">
              Start Time
            </label>
            <input
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-apple-dark dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-apple-dark dark:text-white">
              End Time
            </label>
            <input
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-apple-dark dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-apple-dark dark:text-white">
              Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-apple-dark dark:text-white"
              rows={3}
              placeholder="Add notes..."
            />
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!userName || !startTime || !endTime}
            className="flex-1 px-4 py-2 bg-apple-blue text-white rounded-lg hover:bg-apple-blue-hover disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

// Booking Detail Modal Component
function BookingDetailModal({
  booking,
  onUpdate,
  onDelete,
  onClose,
}: {
  booking: Booking
  onUpdate: (id: string, booking: BookingRequest) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const [userName, setUserName] = useState(booking.user_name)
  const [startTime, setStartTime] = useState(
    new Date(booking.start_time).toISOString().slice(0, 16)
  )
  const [endTime, setEndTime] = useState(new Date(booking.end_time).toISOString().slice(0, 16))
  const [notes, setNotes] = useState(booking.notes || '')

  const handleUpdate = () => {
    if (!userName || !startTime || !endTime) return

    const start = new Date(startTime)
    const end = new Date(endTime)

    if (end <= start) {
      alert('End time must be after start time')
      return
    }

    onUpdate(booking.id, {
      user_name: userName,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      notes: notes || undefined,
    })
  }

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this booking?')) {
      onDelete(booking.id)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md">
        <h2 className="text-xl font-semibold mb-4 text-apple-dark dark:text-white">Edit Booking</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-apple-dark dark:text-white">
              User Name
            </label>
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-apple-dark dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-apple-dark dark:text-white">
              Start Time
            </label>
            <input
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-apple-dark dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-apple-dark dark:text-white">
              End Time
            </label>
            <input
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-apple-dark dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-apple-dark dark:text-white">
              Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-apple-dark dark:text-white"
              rows={3}
            />
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button
            onClick={handleDelete}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Delete
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            onClick={handleUpdate}
            disabled={!userName || !startTime || !endTime}
            className="flex-1 px-4 py-2 bg-apple-blue text-white rounded-lg hover:bg-apple-blue-hover disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

