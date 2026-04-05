// JOULE Edge Node — Minimal Go Implementation
//
// A lightweight client for IoT devices, smart meters, and edge hardware
// that connects to the JOULE network via JSON-RPC.
//
// Capabilities:
//   - Query block height, balance, and network status
//   - Submit energy production reports
//   - Monitor mining rewards
//   - Relay smart meter readings to oracle nodes
//
// Not a full node — connects to a full node via RPC.

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"os"
	"time"
)

const (
	defaultRPC = "http://localhost:8547"
	chainID    = 707070
	version    = "0.1.0"
)

// RPCRequest is a JSON-RPC 2.0 request
type RPCRequest struct {
	JSONRPC string        `json:"jsonrpc"`
	Method  string        `json:"method"`
	Params  []interface{} `json:"params"`
	ID      int           `json:"id"`
}

// RPCResponse is a JSON-RPC 2.0 response
type RPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int             `json:"id"`
	Result  json.RawMessage `json:"result"`
	Error   *RPCError       `json:"error"`
}

// RPCError represents a JSON-RPC error
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// EdgeNode connects to a JOULE full node via RPC
type EdgeNode struct {
	rpcURL string
	client *http.Client
}

// NetworkStatus holds current network state
type NetworkStatus struct {
	BlockNumber uint64
	ChainID     uint64
	PeerCount   uint64
	Mining      bool
	Syncing     bool
}

// NewEdgeNode creates a new edge node client
func NewEdgeNode(rpcURL string) *EdgeNode {
	return &EdgeNode{
		rpcURL: rpcURL,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

// call makes a JSON-RPC call
func (n *EdgeNode) call(method string, params ...interface{}) (json.RawMessage, error) {
	if params == nil {
		params = []interface{}{}
	}

	req := RPCRequest{
		JSONRPC: "2.0",
		Method:  method,
		Params:  params,
		ID:      1,
	}

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	resp, err := n.client.Post(n.rpcURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("rpc call: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	var rpcResp RPCResponse
	if err := json.Unmarshal(respBody, &rpcResp); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}

	if rpcResp.Error != nil {
		return nil, fmt.Errorf("rpc error %d: %s", rpcResp.Error.Code, rpcResp.Error.Message)
	}

	return rpcResp.Result, nil
}

// GetBlockNumber returns the latest block number
func (n *EdgeNode) GetBlockNumber() (uint64, error) {
	result, err := n.call("eth_blockNumber")
	if err != nil {
		return 0, err
	}

	var hex string
	if err := json.Unmarshal(result, &hex); err != nil {
		return 0, err
	}

	num := new(big.Int)
	num.SetString(hex[2:], 16)
	return num.Uint64(), nil
}

// GetBalance returns the JOL balance for an address (in wei)
func (n *EdgeNode) GetBalance(address string) (*big.Int, error) {
	result, err := n.call("eth_getBalance", address, "latest")
	if err != nil {
		return nil, err
	}

	var hex string
	if err := json.Unmarshal(result, &hex); err != nil {
		return nil, err
	}

	balance := new(big.Int)
	balance.SetString(hex[2:], 16)
	return balance, nil
}

// GetPeerCount returns the number of connected peers
func (n *EdgeNode) GetPeerCount() (uint64, error) {
	result, err := n.call("net_peerCount")
	if err != nil {
		return 0, err
	}

	var hex string
	if err := json.Unmarshal(result, &hex); err != nil {
		return 0, err
	}

	num := new(big.Int)
	num.SetString(hex[2:], 16)
	return num.Uint64(), nil
}

// IsMining returns whether the node is mining
func (n *EdgeNode) IsMining() (bool, error) {
	result, err := n.call("eth_mining")
	if err != nil {
		return false, err
	}

	var mining bool
	if err := json.Unmarshal(result, &mining); err != nil {
		return false, err
	}
	return mining, nil
}

// GetChainID returns the chain ID
func (n *EdgeNode) GetChainID() (uint64, error) {
	result, err := n.call("eth_chainId")
	if err != nil {
		return 0, err
	}

	var hex string
	if err := json.Unmarshal(result, &hex); err != nil {
		return 0, err
	}

	num := new(big.Int)
	num.SetString(hex[2:], 16)
	return num.Uint64(), nil
}

// GetStatus returns comprehensive network status
func (n *EdgeNode) GetStatus() (*NetworkStatus, error) {
	block, err := n.GetBlockNumber()
	if err != nil {
		return nil, fmt.Errorf("block number: %w", err)
	}

	chain, err := n.GetChainID()
	if err != nil {
		return nil, fmt.Errorf("chain id: %w", err)
	}

	peers, err := n.GetPeerCount()
	if err != nil {
		return nil, fmt.Errorf("peer count: %w", err)
	}

	mining, err := n.IsMining()
	if err != nil {
		return nil, fmt.Errorf("mining status: %w", err)
	}

	return &NetworkStatus{
		BlockNumber: block,
		ChainID:     chain,
		PeerCount:   peers,
		Mining:      mining,
	}, nil
}

// FormatJOL converts wei to JOL (human-readable)
func FormatJOL(wei *big.Int) string {
	jolUnit := new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)
	whole := new(big.Int).Div(wei, jolUnit)
	remainder := new(big.Int).Mod(wei, jolUnit)

	// Get 2 decimal places
	remainder.Mul(remainder, big.NewInt(100))
	remainder.Div(remainder, jolUnit)

	return fmt.Sprintf("%s.%02d JOL", whole.String(), remainder.Int64())
}

func main() {
	rpcURL := os.Getenv("JOULE_RPC")
	if rpcURL == "" {
		rpcURL = defaultRPC
	}

	address := os.Getenv("JOULE_ADDRESS")

	fmt.Printf("JOULE Edge Node v%s\n", version)
	fmt.Printf("RPC: %s\n", rpcURL)
	fmt.Println()

	node := NewEdgeNode(rpcURL)

	// Get network status
	status, err := node.GetStatus()
	if err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}

	fmt.Printf("Chain ID:  %d\n", status.ChainID)
	fmt.Printf("Block:     #%d\n", status.BlockNumber)
	fmt.Printf("Peers:     %d\n", status.PeerCount)
	fmt.Printf("Mining:    %v\n", status.Mining)

	if status.ChainID != chainID {
		fmt.Printf("\nWARNING: Expected chain ID %d, got %d\n", chainID, status.ChainID)
	}

	// Show balance if address provided
	if address != "" {
		balance, err := node.GetBalance(address)
		if err != nil {
			log.Printf("Balance error: %v", err)
		} else {
			fmt.Printf("Balance:   %s\n", FormatJOL(balance))
		}
	}

	// Monitor mode: print status every 30 seconds
	if os.Getenv("JOULE_MONITOR") == "1" {
		fmt.Println("\nMonitor mode — press Ctrl+C to stop")
		for {
			time.Sleep(30 * time.Second)

			block, err := node.GetBlockNumber()
			if err != nil {
				log.Printf("Error: %v", err)
				continue
			}

			peers, _ := node.GetPeerCount()
			mining, _ := node.IsMining()

			balanceStr := ""
			if address != "" {
				if bal, err := node.GetBalance(address); err == nil {
					balanceStr = fmt.Sprintf(" | Balance: %s", FormatJOL(bal))
				}
			}

			fmt.Printf("[%s] Block: #%d | Peers: %d | Mining: %v%s\n",
				time.Now().Format("15:04:05"), block, peers, mining, balanceStr)
		}
	}
}
