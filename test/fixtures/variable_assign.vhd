-- Phase 3: variable assignment with := (not just <=).
-- Phase 3 will recognize both <= and := for state assignments.
--
-- EXPECT idle -> running | go = '1'
-- EXPECT running -> idle | (always)

library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity fsm_var_assign is
end fsm_var_assign;

architecture rtl of fsm_var_assign is
  type state_t is (idle, running);
  signal state : state_t;
  variable next_state : state_t;
  signal go : std_logic;
begin
  process
    variable next_state : state_t;
  begin
    case state is
      when idle =>
        if go = '1' then
          next_state := running;
          state <= next_state;
        end if;
      when running =>
        next_state := idle;
        state <= next_state;
    end case;
    wait;
  end process;
end rtl;
