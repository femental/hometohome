-- Double-booking guard: no two occupying bookings may overlap on the same room.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE bookings ADD CONSTRAINT booking_no_overlap
  EXCLUDE USING gist (room_id WITH =, daterange(move_in, move_out, '[)') WITH &&)
  WHERE (status IN ('awaiting_payment', 'confirmed'));

ALTER TABLE bookings ADD CONSTRAINT booking_range_valid CHECK (move_out > move_in);
