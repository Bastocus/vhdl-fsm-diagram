-- Phase 0 baseline: single-process FSM with simple transitions.
-- Should pass immediately (current parser handles this).
--
-- EXPECT idle -> running | start = '1'
-- EXPECT running -> idle | done = '1'
-- EXPECT running -> done_state | error = '1'

library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity fsm_test is
end fsm_test;

architecture rtl of fsm_test is
  type state_t is (idle, running, done_state);
  signal state : state_t;
  signal start, done, error : std_logic;
begin
  process
  begin
    case state is
      when idle =>
        if start = '1' then
          state <= running;
        end if;
      when running =>
        if done = '1' then
          state <= idle;
        elsif error = '1' then
          state <= done_state;
        end if;
      when done_state =>
        state <= idle;
    end case;
    wait;
  end process;
end rtl;
